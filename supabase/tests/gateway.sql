-- Pasarela TUU (Sesión 10b): montos del servidor (abono, total, saldo),
-- un cobro pendiente a la vez (vence a los 30 min), máximo 5 intentos por
-- hora, confirm_payment con montos parciales, rechazo que NO libera el hold,
-- pagos tardíos, duplicados y que nada de la cuenta se exponga.
-- Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/gateway.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)

begin;

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
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
  perform set_config('role', p_role, true);
end;
$$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.hold(p_slug text, p_email text, p_in date, p_out date, p_plan text default 'deposit', p_method text default 'gateway')
returns jsonb language sql as $$
  select public.create_booking_hold(p_slug, p_in, p_out, 2, 'Ana Test', p_email, '+56911111111', 'Chile',
           '{"requested": false}'::jsonb, null,
           (public.pricing_core((select id from public.properties where slug = p_slug), p_in, p_out, 2) ->> 'total_clp')::int,
           p_method, p_plan);
$$;

create function pg_temp.res(v jsonb) returns uuid language sql as $$ select (v ->> 'reservation_id')::uuid; $$;

-- Cobro por pasarela; devuelve el id del pago (= x_reference).
create function pg_temp.charge(p_res uuid) returns jsonb language sql as $$
  select public.create_gateway_payment(p_res);
$$;

create function pg_temp.pay(p_ref text, p_status text, p_amount int) returns text language sql as $$
  select public.confirm_payment('tuu', p_ref, p_status, p_amount) ->> 'outcome';
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d date;
  o uuid; g uuid; acc uuid; acc_off uuid; p uuid;
  v jsonb; c jsonb; c2 jsonb;
  r uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  dep int; tot int;
  frozen timestamptz;
  ref text;
  outc text;
begin
  d := hoy + 70;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST GW', '90000004-9', true) returning id into o;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp) values (o, 'TEST GW', 40000, 6000) returning id into g;
  insert into public.payment_accounts (owner_id, label, provider, gateway_account_id, gateway_environment, gateway_secret_name)
    values (o, 'TEST TUU', 'tuu', 'TEST-GW-ACC', 'integration', 'TUU_TEST_GW') returning id into acc;
  insert into public.payment_accounts (owner_id, label) values (o, 'TEST sin pasarela') returning id into acc_off;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, payment_account_id, allowed_payment_methods)
    values (o, g, 'test-gw', 'TEST GW', 'Iquique', 'publicada', 1, 0, 4, acc, '{bank_transfer,payment_link,gateway}') returning id into p;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, payment_account_id, allowed_payment_methods)
    values (o, g, 'test-gw-off', 'TEST GW OFF', 'Iquique', 'publicada', 1, 0, 4, acc_off, '{bank_transfer,payment_link,gateway}');
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, payment_account_id)
    values (o, g, 'test-gw-nogw', 'TEST GW NOGW', 'Iquique', 'publicada', 1, 0, 4, acc);

  -- ═══ 1. Hold por pasarela con abono y montos del servidor ═════════════
  v := pg_temp.hold('test-gw', 'gw1@test.invalid', d, d + 3);
  r := pg_temp.res(v);
  select deposit_required_clp, total_clp into dep, tot from public.reservations where id = r;
  perform pg_temp.rec('Hold por pasarela con abono (antes solo total)', 'true|gateway|40000|126000',
    (v ->> 'ok') || '|' || (v ->> 'payment_mode') || '|' || dep || '|' || tot);
  perform pg_temp.rec('Pasarela sin configurar en la cuenta → no hay hold', 'gateway_not_configured',
    pg_temp.hold('test-gw-off', 'gw0@test.invalid', d, d + 1) ->> 'reason');
  perform pg_temp.rec('Pasarela no permitida en la propiedad → no hay hold', 'method_not_allowed',
    pg_temp.hold('test-gw-nogw', 'gw0b@test.invalid', d, d + 1, 'full') ->> 'reason');

  c := pg_temp.charge(r);
  ref := c ->> 'reference';
  perform pg_temp.rec('Cobro del abono: monto y tipo del servidor, referencia de 24 hex (TUU: máx. 26)', 'true|40000|deposit|true',
    (c ->> 'ok') || '|' || (c ->> 'amount_clp') || '|' || (c ->> 'installment') || '|' ||
    (ref ~ '^[0-9a-f]{24}$' and exists (select 1 from public.payments where id = (c ->> 'payment_id')::uuid and provider_payment_id = ref))::text);
  perform pg_temp.rec('  la cuenta se entrega con el NOMBRE del secreto, nunca una clave', 'TUU_TEST_GW|TEST-GW-ACC',
    (c #>> '{account,gateway_secret_name}') || '|' || (c #>> '{account,gateway_account_id}'));
  perform pg_temp.rec('Segundo cobro mientras hay uno pendiente → rechazado', 'payment_in_progress', pg_temp.charge(r) ->> 'reason');
  update public.payments set created_at = now() - interval '31 minutes' where provider_payment_id = ref;
  c2 := pg_temp.charge(r);
  perform pg_temp.rec('Pendiente de más de 30 min → abandonado y se permite uno nuevo', 'true|anulado',
    (c2 ->> 'ok') || '|' || (select status::text from public.payments where provider_payment_id = ref));

  -- Un cobro que vencimos (anulado) y luego llega aprobado: el dinero manda.
  perform pg_temp.rec('Aviso aprobado de un cobro abandonado → se procesa igual', 'confirmed', pg_temp.pay(ref, 'approved', dep));
  perform pg_temp.rec('  confirmada con el abono pagado y el desglose congelado', 'confirmada|40000|86000|true',
    (select status || '|' || amount_paid || '|' || balance_due || '|' || (tax_frozen_at is not null) from public.reservations where id = r));
  select tax_frozen_at into frozen from public.reservations where id = r;
  outc := pg_temp.pay(ref, 'approved', dep);
  perform pg_temp.rec('Aviso repetido ×3 → ya procesado', 'already_processed|already_processed|already_processed',
    outc || '|' || pg_temp.pay(ref, 'approved', dep) || '|' || pg_temp.pay(ref, 'approved', dep));
  -- El segundo cobro (c2) quedó pendiente con el monto del abono: si llega, sobra.
  perform pg_temp.rec('El otro cobro del abono también llega → abono de más = saldo parcial', 'balance_paid',
    pg_temp.pay(c2 ->> 'reference', 'approved', dep));
  update public.reservations set amount_paid = dep where id = r; -- se deja como si solo hubiera llegado el primero
  update public.reservations set needs_refund = false where id = r;

  -- ═══ 2. Saldo por pasarela ════════════════════════════════════════════
  c := pg_temp.charge(r);
  perform pg_temp.rec('Cobro del saldo: monto y tipo del servidor', 'true|86000|balance', (c ->> 'ok') || '|' || (c ->> 'amount_clp') || '|' || (c ->> 'installment'));
  outc := pg_temp.pay(c ->> 'reference', 'approved', 86000);
  perform pg_temp.rec('Saldo aprobado → pagada completa, acceso liberado, desglose sin recongelar', 'balance_paid|0|true|true',
    outc || '|' ||
    (select balance_due || '|' || access_released || '|' || (tax_frozen_at = frozen) from public.reservations where id = r));
  perform pg_temp.rec('Nada que pagar → no se crea un cobro', 'nothing_to_pay', pg_temp.charge(r) ->> 'reason');

  -- ═══ 3. Monto distinto ════════════════════════════════════════════════
  r2 := pg_temp.res(pg_temp.hold('test-gw', 'gw2@test.invalid', d + 5, d + 6, 'full'));
  c := pg_temp.charge(r2);
  outc := pg_temp.pay(c ->> 'reference', 'approved', 1000);
  perform pg_temp.rec('Monto distinto al esperado de ese pago → no confirma, incidente', 'amount_mismatch|cancelada|true|1',
    outc || '|' ||
    (select status || '|' || needs_refund from public.reservations where id = r2) || '|' ||
    (select count(*) from public.payment_incidents where reservation_id = r2 and kind = 'amount_mismatch'));

  -- ═══ 4. Rechazo: se registra y el hold se mantiene (decisión 10b) ═════
  r3 := pg_temp.res(pg_temp.hold('test-gw', 'gw3@test.invalid', d + 8, d + 10));
  c := pg_temp.charge(r3);
  outc := pg_temp.pay(c ->> 'reference', 'rejected', null);
  perform pg_temp.rec('Rechazado → pago rechazado, la reserva sigue en hold y ocupando', 'rejected|rechazado|hold|active',
    outc || '|' ||
    (select status::text from public.payments where provider_payment_id = c ->> 'reference') || '|' ||
    (select status::text from public.reservations where id = r3) || '|' ||
    (select status::text from public.calendar_occupancies where reservation_id = r3));
  c2 := pg_temp.charge(r3);
  perform pg_temp.rec('  el huésped reintenta y paga → confirmada', 'true|confirmed',
    (c2 ->> 'ok') || '|' || pg_temp.pay(c2 ->> 'reference', 'approved', (c2 ->> 'amount_clp')::int));
  r4 := pg_temp.res(pg_temp.hold('test-gw', 'gw4@test.invalid', d + 12, d + 13, 'full'));
  c := pg_temp.charge(r4);
  outc := pg_temp.pay(c ->> 'reference', 'abandoned', null);
  perform pg_temp.rec('Abandonado → libera las fechas', 'released|cancelada',
    outc || '|' || (select status::text from public.reservations where id = r4));

  -- ═══ 5. Pagos tardíos ═════════════════════════════════════════════════
  r5 := pg_temp.res(pg_temp.hold('test-gw', 'gw5@test.invalid', d + 15, d + 16, 'full'));
  c := pg_temp.charge(r5);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r5;
  update public.payments set created_at = now() - interval '40 minutes' where provider_payment_id = c ->> 'reference'; -- fuera del margen del job
  perform public.release_expired_holds();
  outc := pg_temp.pay(c ->> 'reference', 'approved', (c ->> 'amount_clp')::int);
  perform pg_temp.rec('Aprobado tarde con fechas libres → se recupera', 'late_confirmed|confirmada',
    outc || '|' || (select status::text from public.reservations where id = r5));
  r6 := pg_temp.res(pg_temp.hold('test-gw', 'gw6@test.invalid', d + 18, d + 19, 'full'));
  c := pg_temp.charge(r6);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r6;
  update public.payments set created_at = now() - interval '40 minutes' where provider_payment_id = c ->> 'reference';
  perform public.release_expired_holds();
  perform pg_temp.hold('test-gw', 'gw6b@test.invalid', d + 18, d + 19, 'full', 'bank_transfer');
  outc := pg_temp.pay(c ->> 'reference', 'approved', (c ->> 'amount_clp')::int);
  perform pg_temp.rec('Aprobado tarde con fechas tomadas → reembolso pendiente', 'needs_refund|true',
    outc || '|' || (select needs_refund from public.reservations where id = r6));

  -- ═══ 6. Saldo pagado por otra vía y luego llega el de la pasarela ═════
  r2 := pg_temp.res(pg_temp.hold('test-gw', 'gw7@test.invalid', d + 22, d + 24));
  c := pg_temp.charge(r2);
  perform pg_temp.pay(c ->> 'reference', 'approved', (c ->> 'amount_clp')::int); -- abono
  c := pg_temp.charge(r2);                                                         -- cobro del saldo pendiente…
  update public.reservations set amount_paid = total_clp where id = r2;           -- …pero pagó por transferencia
  outc := pg_temp.pay(c ->> 'reference', 'approved', (c ->> 'amount_clp')::int);
  perform pg_temp.rec('Saldo que llega cuando ya no hay saldo → duplicado, reembolso', 'duplicate_payment|true',
    outc || '|' || (select needs_refund from public.reservations where id = r2));

  -- ═══ 7. Límite de 5 intentos por hora ═════════════════════════════════
  r2 := pg_temp.res(pg_temp.hold('test-gw', 'gw8@test.invalid', d + 26, d + 27, 'full'));
  insert into public.payments (reservation_id, provider, method, kind, status, amount_clp, payment_account_id)
    select r2, 'tuu', 'gateway', 'cobro', 'rechazado', 1000, acc from generate_series(1, 5);
  perform pg_temp.rec('6.º intento en una hora → rechazado', 'too_many_attempts', pg_temp.charge(r2) ->> 'reason');

  -- ═══ 8. Estado público y permisos ═════════════════════════════════════
  r2 := pg_temp.res(pg_temp.hold('test-gw', 'gw9@test.invalid', d + 30, d + 32));
  c := pg_temp.charge(r2);
  perform pg_temp.pay(c ->> 'reference', 'approved', (c ->> 'amount_clp')::int);
  perform pg_temp.rec('Estado público: puede pagar el saldo en línea', 'true',
    public.public_booking_status((select public_code from public.reservations where id = r2)) #>> '{payment,can_pay_online}');
  perform pg_temp.rec('  sin datos de la cuenta ni de la pasarela', '0',
    (select count(*)::text from jsonb_object_keys(public.public_booking_status((select public_code from public.reservations where id = r2)) -> 'payment') k
      where k ~* 'secret|account|gateway_|provider'));
  update public.properties set allowed_payment_methods = '{bank_transfer,payment_link}' where id = p;
  perform pg_temp.rec('Pasarela retirada de la propiedad → ya no puede pagar en línea', 'false',
    public.public_booking_status((select public_code from public.reservations where id = r2)) #>> '{payment,can_pay_online}');
  perform pg_temp.rec('  y no se puede crear el cobro', 'method_not_allowed', pg_temp.charge(r2) ->> 'reason');

  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: create_gateway_payment', 'denegado', pg_temp.q(format($s$select public.create_gateway_payment(%L)::text$s$, r2)));
  perform pg_temp.rec('Anon: gateway_account_by_external_id', 'denegado', pg_temp.q($s$select public.gateway_account_by_external_id('TEST-GW-ACC')::text$s$));
  perform pg_temp.rec('Anon: record_unknown_gateway_payment', 'denegado', pg_temp.q($s$select public.record_unknown_gateway_payment('tuu', 'x', null)::text$s$));
  perform pg_temp.as_role('authenticated', gen_random_uuid());
  perform pg_temp.rec('Autenticado: create_gateway_payment', 'denegado', pg_temp.q(format($s$select public.create_gateway_payment(%L)::text$s$, r2)));
  perform pg_temp.rec('Autenticado: gateway_payment_for_account', 'denegado', pg_temp.q(format($s$select public.gateway_payment_for_account('x', %L)::text$s$, acc)));
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Búsqueda de cuenta por x_account_id (sin la clave)', 'tuu|TUU_TEST_GW|false',
    (public.gateway_account_by_external_id('TEST-GW-ACC') ->> 'provider') || '|' ||
    (public.gateway_account_by_external_id('TEST-GW-ACC') ->> 'gateway_secret_name') || '|' ||
    (public.gateway_account_by_external_id('TEST-GW-ACC') ? 'secret')::text);
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
