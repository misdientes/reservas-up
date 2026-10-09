-- Pagos manuales y parciales (Sesión 10a): abono, plazo de 12 h, saldo 48 h
-- antes, 100 % cuando no alcanza, registro idempotente por el admin, pagos
-- tardíos, liberación manual, datos bancarios solo con el enlace y la
-- regla anti-doble-reserva con holds manuales.
-- Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/manual_payments.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)

begin;

-- Los holds solo se toman en modo 'online'. Producción está en 'whatsapp':
-- se activa aquí, dentro de la transacción que termina en ROLLBACK. Los
-- medios permitidos quedan en el valor por defecto (sin pasarela).
update public.app_settings set value = 'online' where key = 'booking_mode';
update public.app_settings set value = 'bank_transfer,payment_link' where key = 'allowed_payment_methods';

create temp table test_results (
  n        integer generated always as identity,
  caso     text,
  esperado text,
  obtenido text
) on commit drop;

create function pg_temp.rec(p_caso text, p_esperado text, p_obtenido text)
returns void language sql security definer as $$
  insert into test_results (caso, esperado, obtenido) values (p_caso, p_esperado, p_obtenido);
$$;

create function pg_temp.q(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception
  when insufficient_privilege then return 'denegado';
  when others then return sqlstate;
end;
$$;

create function pg_temp.as_role(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_sub, 'role', p_role)::text end,
    true
  );
  perform set_config('role', p_role, true);
end;
$$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Hold como lo haría create-booking (con el total del motor).
create function pg_temp.mhold(p_slug text, p_email text, p_in date, p_out date,
                              p_method text default 'bank_transfer', p_plan text default 'deposit')
returns jsonb language sql as $$
  select public.create_booking_hold(p_slug, p_in, p_out, 2, 'TEST', p_email, '+56911111111', 'Chile',
           '{"requested": false}'::jsonb, null,
           (public.pricing_core((select id from public.properties where slug = p_slug), p_in, p_out, 2) ->> 'total_clp')::int,
           p_method, p_plan);
$$;

create function pg_temp.res(p_v jsonb) returns uuid language sql as $$
  select (p_v ->> 'reservation_id')::uuid;
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d date;
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc uuid := gen_random_uuid();
  o uuid; g uuid; acc uuid; p uuid; p2 uuid; p3 uuid;
  arrival timestamptz;
  v jsonb; w jsonb;
  r uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  frozen_at timestamptz;
  code text;
  pcode text;
begin
  d := hoy + 60;

  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST MP', 'TEST-MP', true) returning id into o;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp)
    values (o, 'TEST MP', 40000, 6000) returning id into g;
  -- Noche de llegada cara (temporada de un solo día) para probar "primera noche".
  insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp)
    values (g, 'TEST alta', daterange(d + 40, d + 41), 90000);
  insert into public.payment_accounts (owner_id, label, bank_name, account_type, account_number, holder_name, holder_rut, holder_email)
    values (o, 'TEST', 'Banco TEST', 'Cuenta corriente', 'TEST-000123', 'TEST MP', '11.111.111-1', 'test@test.invalid') returning id into acc;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, check_in_time, payment_account_id)
    values (o, g, 'test-mp', 'TEST MP', 'Iquique', 'publicada', 1, 0, 4, '15:00', acc) returning id into p;
  -- Sin cuenta de cobro; acepta también la pasarela (para el choque manual vs pasarela).
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, allowed_payment_methods)
    values (o, g, 'test-mp-2', 'TEST MP 2', 'Iquique', 'publicada', 1, 0, 4, '{bank_transfer,payment_link,gateway}') returning id into p2;
  -- Ajustes propios: abono de 2 noches mínimas.
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, payment_account_id, deposit_min_nights)
    values (o, g, 'test-mp-3', 'TEST MP 3', 'Iquique', 'publicada', 1, 0, 4, acc, 2) returning id into p3;

  -- ═══ 1. Abono, plazo y 100 % ══════════════════════════════════════════
  perform pg_temp.rec('Abono 3 noches: max(30 % de 126.000, 1.ª noche 40.000)', '40000|86000',
    (select (x ->> 'deposit_clp') || '|' || (x ->> 'balance_clp') from (select public.quote_payment_plan('test-mp', d, d + 3, 2) x) s));
  perform pg_temp.rec('Abono 10 noches: 30 % de 406.000 > 1 noche', '121800',
    public.quote_payment_plan('test-mp', d, d + 10, 2) ->> 'deposit_clp');
  perform pg_temp.rec('Abono: cuenta la noche de LLEGADA (90.000), no el promedio', '90000',
    public.quote_payment_plan('test-mp', d + 40, d + 42, 2) ->> 'deposit_clp');
  perform pg_temp.rec('Ajuste por propiedad: abono mínimo de 2 noches', '80000',
    public.quote_payment_plan('test-mp-3', d, d + 3, 2) ->> 'deposit_clp');

  arrival := (d + time '15:00') at time zone 'America/Santiago';
  perform pg_temp.rec('Saldo vence 48 h antes de la llegada (15:00 de Chile)', 'true',
    ((public.quote_payment_plan('test-mp', d, d + 3, 2) ->> 'balance_due_at')::timestamptz = arrival - interval '48 hours')::text);
  perform pg_temp.rec('Reserva a 61 h de la llegada → abono permitido', 'false',
    public.payment_plan_core(p, d, 126000, null, arrival - interval '61 hours') ->> 'requires_full');
  perform pg_temp.rec('Reserva a 60 h (plazo de 12 h toca el vencimiento) → 100 %', 'true',
    public.payment_plan_core(p, d, 126000, null, arrival - interval '60 hours') ->> 'requires_full');
  perform pg_temp.rec('Reserva a 55 h de la llegada → 100 %', 'true|126000',
    (select (x ->> 'requires_full') || '|' || (x ->> 'deposit_clp') from (select public.payment_plan_core(p, d, 126000, null, arrival - interval '55 hours') x) s));
  perform pg_temp.rec('Reserva con menos de 48 h → 100 %', 'true',
    public.payment_plan_core(p, d, 126000, null, arrival - interval '30 hours') ->> 'requires_full');
  perform pg_temp.rec('Plazo manual = 12 h', 'true',
    ((public.payment_plan_core(p, d, 126000, null, arrival - interval '100 hours') ->> 'manual_expires_at')::timestamptz = arrival - interval '88 hours')::text);
  perform pg_temp.rec('Plazo manual nunca después de la llegada', 'true',
    ((public.payment_plan_core(p, d, 126000, null, arrival - interval '5 hours') ->> 'manual_expires_at')::timestamptz = arrival)::text);
  perform pg_temp.rec('Plan público: sin datos bancarios ni impuestos', '0',
    (select count(*)::text from jsonb_object_keys(public.quote_payment_plan('test-mp', d, d + 3, 2)) k
      where k ~* 'bank|account|holder|rut|net|vat|iva|tax'));

  -- ═══ 2. Hold manual ═══════════════════════════════════════════════════
  v := pg_temp.mhold('test-mp', 'mp1@test.invalid', d, d + 3);
  r := pg_temp.res(v);
  perform pg_temp.rec('Hold manual por transferencia con abono', 'true|manual|40000', (v ->> 'ok') || '|' || (v ->> 'payment_mode') || '|' || (v ->> 'deposit_clp'));
  perform pg_temp.rec('  vence en 12 h', 'true',
    ((select hold_expires_at from public.reservations where id = r) between now() + interval '11 hours 59 minutes' and now() + interval '12 hours 1 minute')::text);
  perform pg_temp.rec('  ocupa las noches (definición única)', 'hold|true',
    (select a.kind || '|' || (a.stay = daterange(d, d + 3)) from public.active_occupancies(p) a where a.reservation_id = r));
  select r0.code, r0.public_code into code, pcode from public.reservations r0 where r0.id = r;
  perform pg_temp.rec('  código corto legible (UP-XXXXX, sin ambiguos)', 'true', (code ~ '^UP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$')::text);
  perform pg_temp.rec('  el código corto NO consulta el estado', 'null', coalesce(public.public_booking_status(code)::text, 'null'));
  perform pg_temp.rec('  un código secreto falso no consulta el estado', 'null', coalesce(public.public_booking_status(repeat('0', 32))::text, 'null'));
  w := public.public_booking_status(pcode);
  perform pg_temp.rec('  con el enlace: esperando pago, abono a pagar y datos bancarios', 'esperando_pago|40000|Banco TEST|TEST-000123',
    (w ->> 'status') || '|' || (w #>> '{payment,pay_now_clp}') || '|' || (w #>> '{payment,bank,bank_name}') || '|' || (w #>> '{payment,bank,account_number}'));
  perform pg_temp.rec('  el estado muestra el código corto, nunca el secreto', 'true|false',
    ((w ->> 'code') = code)::text || '|' || (w::text like '%' || pcode || '%')::text);
  perform pg_temp.rec('Vistas públicas sin columnas bancarias', '0',
    (select count(*)::text from information_schema.columns
      where table_schema = 'public' and table_name like 'public\_%' and column_name ~* 'bank|account|holder|rut'));

  perform pg_temp.rec('Dos holds sobre las mismas fechas (manual vs manual) → 1 gana', 'unavailable',
    pg_temp.mhold('test-mp', 'mp1b@test.invalid', d + 1, d + 2) ->> 'reason');
  v := pg_temp.mhold('test-mp-2', 'mp2@test.invalid', d, d + 2, 'payment_link', 'full');
  perform pg_temp.rec('Hold manual por link (sin cuenta bancaria: permitido)', 'true', v ->> 'ok');
  perform pg_temp.rec('Manual vs pasarela sobre las mismas fechas → 1 gana', 'unavailable',
    pg_temp.mhold('test-mp-2', 'mp2b@test.invalid', d + 1, d + 3, 'gateway', 'full') ->> 'reason');
  perform pg_temp.rec('Transferencia sin cuenta de cobro → rechazado', 'payment_account_missing',
    pg_temp.mhold('test-mp-2', 'mp2c@test.invalid', d + 10, d + 11) ->> 'reason');
  perform pg_temp.rec('Pasarela no permitida por defecto', 'method_not_allowed',
    pg_temp.mhold('test-mp', 'mp1c@test.invalid', d + 10, d + 11, 'gateway', 'full') ->> 'reason');
  perform pg_temp.rec('Abono pedido cuando se exige el 100 % → rechazado', 'full_payment_required',
    pg_temp.mhold('test-mp', 'mp1d@test.invalid', hoy + 1, hoy + 2) ->> 'reason');
  v := pg_temp.mhold('test-mp', 'mp1e@test.invalid', hoy + 1, hoy + 2, 'bank_transfer', 'full');
  perform pg_temp.rec('  con el total sí, y el abono exigido es el total', 'true|true',
    (v ->> 'ok') || '|' || ((v ->> 'deposit_clp') = (v ->> 'total_clp'))::text);
  update public.app_settings set value = 'whatsapp' where key = 'booking_mode';
  perform pg_temp.rec('Modo WhatsApp → no se toman holds', 'booking_disabled',
    pg_temp.mhold('test-mp', 'mp1f@test.invalid', d + 20, d + 21) ->> 'reason');
  update public.app_settings set value = 'online' where key = 'booking_mode';

  -- ═══ 3. Vencimiento: el job libera el hold manual ═════════════════════
  v := pg_temp.mhold('test-mp', 'mp3@test.invalid', d + 5, d + 7);
  r2 := pg_temp.res(v);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r2;
  perform public.release_expired_holds();
  perform pg_temp.rec('Hold manual vencido → el job lo libera', 'cancelada|hold_expirado',
    (select status || '|' || cancellation_reason from public.reservations where id = r2));
  perform pg_temp.rec('  las fechas vuelven a estar libres', 'true', pg_temp.mhold('test-mp', 'mp3b@test.invalid', d + 5, d + 6) ->> 'ok');

  -- ═══ 4. Permisos ══════════════════════════════════════════════════════
  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-mp@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST Encargado MP');
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: register_manual_payment', 'denegado',
    pg_temp.q(format($s$select public.register_manual_payment(%L, 'bank_transfer', 40000, 'X')::text$s$, r)));
  perform pg_temp.rec('Anon: release_manual_hold', 'denegado', pg_temp.q(format($s$select public.release_manual_hold(%L)::text$s$, r)));
  perform pg_temp.rec('Anon: admin_payment_queue', 'denegado', pg_temp.q($s$select count(*)::text from public.admin_payment_queue()$s$));
  perform pg_temp.rec('Anon: payment_accounts', 'denegado', pg_temp.q($s$select count(*)::text from public.payment_accounts$s$));
  perform pg_temp.rec('Anon: payment_plan_core (interna)', 'denegado',
    pg_temp.q(format($s$select public.payment_plan_core(%L, current_date, 1, null)::text$s$, p)));
  perform pg_temp.rec('Anon: quote_payment_plan (pública)', 'true', pg_temp.q($s$select (public.quote_payment_plan('test-mp', current_date + 150, current_date + 153, 2) ->> 'quotable')$s$));
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: register_manual_payment', 'denegado',
    pg_temp.q(format($s$select public.register_manual_payment(%L, 'bank_transfer', 40000, 'X')::text$s$, r)));
  perform pg_temp.rec('Encargado: release_manual_hold', 'denegado', pg_temp.q(format($s$select public.release_manual_hold(%L)::text$s$, r)));
  perform pg_temp.rec('Encargado: admin_payment_queue', 'denegado', pg_temp.q($s$select count(*)::text from public.admin_payment_queue()$s$));
  perform pg_temp.rec('Encargado: payment_accounts → 0 filas', '0', pg_temp.q($s$select count(*)::text from public.payment_accounts$s$));
  perform pg_temp.as_postgres();
  perform pg_temp.rec('  nada se registró', '0', (select count(*)::text from public.payments where reservation_id = r));

  -- ═══ 5. Registro de pagos (admin) ═════════════════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Primer pago menor al abono → rechazado', 'below_deposit|40000',
    (select (x ->> 'reason') || '|' || (x ->> 'deposit_clp') from (select public.register_manual_payment(r, 'bank_transfer', 39999, 'TEST-OP-0') x) s));
  perform pg_temp.rec('Pago mayor al saldo → rechazado', 'amount_exceeds_balance',
    public.register_manual_payment(r, 'bank_transfer', 126001, 'TEST-OP-0') ->> 'reason');
  perform pg_temp.rec('Sin n.º de operación → rechazado', 'reference_required',
    public.register_manual_payment(r, 'bank_transfer', 40000, '  ') ->> 'reason');
  perform pg_temp.rec('Medio inválido → rechazado', 'invalid_method',
    public.register_manual_payment(r, 'gateway', 40000, 'TEST-OP-0') ->> 'reason');
  v := public.register_manual_payment(r, 'bank_transfer', 40000, 'TEST-OP-1', 'Visto en la cartola');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Abono registrado → confirmada', 'true|confirmed|40000|86000|false',
    (v ->> 'ok') || '|' || (v ->> 'outcome') || '|' || (v ->> 'amount_paid') || '|' || (v ->> 'balance_due') || '|' || (v ->> 'fully_paid'));
  perform pg_temp.rec('  estado abonada, sin acceso, desglose congelado', 'confirmada|abonada|false|true',
    (select r0.status || '|' || public.reservation_payment_state(r0) || '|' || r0.access_released || '|' || (r0.tax_frozen_at is not null)
       from public.reservations r0 where r0.id = r));
  select tax_frozen_at into frozen_at from public.reservations where id = r;
  perform pg_temp.rec('  pago con autor, fecha, cuenta, tipo y nota', 'deposit|true|true|true|Visto en la cartola',
    (select installment || '|' || (registered_by = v_admin) || '|' || (received_at is not null) || '|' || (payment_account_id = acc) || '|' || note
       from public.payments where reservation_id = r));
  w := public.public_booking_status(pcode);
  perform pg_temp.rec('  el huésped ve el saldo y sus datos bancarios', 'confirmada|86000|Banco TEST',
    (w ->> 'status') || '|' || (w #>> '{payment,pay_now_clp}') || '|' || (w #>> '{payment,bank,bank_name}'));

  r2 := pg_temp.res(pg_temp.mhold('test-mp', 'mp4@test.invalid', d + 10, d + 12));
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Mismo pago registrado otra vez → ya registrado', 'already_registered',
    public.register_manual_payment(r, 'bank_transfer', 40000, 'TEST-OP-1') ->> 'outcome');
  perform pg_temp.rec('Misma referencia en otra reserva → rechazado', 'duplicate_reference',
    public.register_manual_payment(r2, 'bank_transfer', 40000, 'TEST-OP-1') ->> 'reason');
  perform pg_temp.rec('Saldo mayor al pendiente → rechazado', 'amount_exceeds_balance',
    public.register_manual_payment(r, 'bank_transfer', 86001, 'TEST-OP-2') ->> 'reason');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('  sigue habiendo 1 solo pago', '1', (select count(*)::text from public.payments where reservation_id = r));

  update public.owners set vat_applies = false where id = o; -- cambio posterior: no debe recongelar
  perform pg_temp.as_role('authenticated', v_admin);
  v := public.register_manual_payment(r, 'payment_link', 86000, 'TEST-LINK-2');
  perform pg_temp.as_postgres();
  update public.owners set vat_applies = true where id = o;
  perform pg_temp.rec('Saldo registrado → pagada completa con acceso', 'payment_registered|0|true|pagada|true',
    (v ->> 'outcome') || '|' || (v ->> 'balance_due') || '|' || (v ->> 'fully_paid') || '|' ||
    (select public.reservation_payment_state(r0) || '|' || r0.access_released from public.reservations r0 where r0.id = r));
  perform pg_temp.rec('  abono + saldo: el desglose se congeló UNA vez', 'true|ok',
    (select (tax_frozen_at = frozen_at)::text || '|' || tax_status from public.reservations where id = r));
  perform pg_temp.rec('  tipos de pago: abono y saldo', 'deposit,balance',
    (select string_agg(installment::text, ',' order by received_at, installment) from public.payments where reservation_id = r));
  perform pg_temp.rec('  pagada: ya no se muestran datos bancarios', 'null|0',
    coalesce(public.public_booking_status(pcode) #>> '{payment,bank}', 'null') || '|' || (public.public_booking_status(pcode) #>> '{payment,pay_now_clp}'));

  -- Saldo vencido: se marca, no se cancela.
  v := pg_temp.mhold('test-mp', 'mp5@test.invalid', d + 15, d + 17);
  r3 := pg_temp.res(v);
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r3, 'bank_transfer', (v ->> 'deposit_clp')::int, 'TEST-OP-5');
  perform pg_temp.as_postgres();
  update public.reservations set balance_due_at = now() - interval '1 hour' where id = r3;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Saldo vencido → visible para el admin, la reserva sigue confirmada', 'saldo_vencido|confirmada|false',
    (select q.payment_state || '|' || q.status || '|' || q.access_released from public.admin_payment_queue() q where q.reservation_id = r3));
  perform pg_temp.rec('Admin ve la cola de pagos', 'true', (select count(*) > 0 from public.admin_payment_queue())::text);
  perform pg_temp.as_postgres();

  -- ═══ 6. Pagos tardíos ═════════════════════════════════════════════════
  v := pg_temp.mhold('test-mp', 'mp6@test.invalid', d + 20, d + 22);
  r4 := pg_temp.res(v);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r4;
  perform public.release_expired_holds();
  perform pg_temp.as_role('authenticated', v_admin);
  w := public.register_manual_payment(r4, 'bank_transfer', (v ->> 'deposit_clp')::int, 'TEST-OP-6');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Pago tardío con fechas libres → se recupera', 'late_confirmed|confirmada|reservation/active',
    (w ->> 'outcome') || '|' || (select status::text from public.reservations where id = r4) || '|' ||
    (select kind || '/' || status from public.calendar_occupancies where reservation_id = r4));

  v := pg_temp.mhold('test-mp', 'mp7@test.invalid', d + 25, d + 27);
  r5 := pg_temp.res(v);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r5;
  perform public.release_expired_holds();
  perform pg_temp.rec('  otra persona toma esas fechas', 'true', pg_temp.mhold('test-mp', 'mp7b@test.invalid', d + 25, d + 26) ->> 'ok');
  perform pg_temp.as_role('authenticated', v_admin);
  w := public.register_manual_payment(r5, 'bank_transfer', (v ->> 'deposit_clp')::int, 'TEST-OP-7');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Pago tardío con fechas tomadas → reembolso pendiente', 'needs_refund|cancelada|true|1|1',
    (w ->> 'outcome') || '|' || (select status::text || '|' || needs_refund from public.reservations where id = r5) || '|' ||
    (select count(*) from public.payments where reservation_id = r5) || '|' ||
    (select count(*) from public.payment_incidents where reservation_id = r5 and kind = 'late_approval_unavailable'));

  -- ═══ 7. Liberar fechas a mano ═════════════════════════════════════════
  v := pg_temp.mhold('test-mp', 'mp8@test.invalid', d + 30, d + 31);
  r6 := pg_temp.res(v);
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('No libera una reserva con pagos', 'not_manual_hold', public.release_manual_hold(r, 'x') ->> 'reason');
  perform pg_temp.as_postgres();
  insert into public.payments (reservation_id, provider, method, kind, status, amount_clp, reference)
    values (r6, null, 'bank_transfer', 'cobro', 'rechazado', 1000, 'TEST-OP-8-RECH');
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('No libera un hold con pagos registrados', 'has_payments', public.release_manual_hold(r6, 'x') ->> 'reason');
  perform pg_temp.as_postgres();
  delete from public.payments where reservation_id = r6;
  perform pg_temp.as_role('authenticated', v_admin);
  w := public.release_manual_hold(r6, '  El huésped avisó que no viaja  ');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Admin libera un hold manual sin pagos', 'released|cancelada|liberado_admin|true|El huésped avisó que no viaja|cancelled',
    (w ->> 'outcome') || '|' ||
    (select status || '|' || cancellation_reason || '|' || (cancelled_by = v_admin) || '|' || cancellation_note from public.reservations where id = r6) || '|' ||
    (select status::text from public.calendar_occupancies where reservation_id = r6));
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
