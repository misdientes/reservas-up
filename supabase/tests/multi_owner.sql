-- Multi-propiedad (Sesión 9b): coherencia dueño/tarifa, cambio de dueño
-- seguro con historial y desglose tributario congelado al confirmar.
-- El sistema no decide nada tributario: aplica owners.vat_applies y lo
-- registra. Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/multi_owner.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)

begin;

-- Los holds solo se toman en modo 'online' (Sesión 10a). Producción está en
-- 'whatsapp': se activa aquí, dentro de la transacción que termina en ROLLBACK.
update public.app_settings set value = 'online' where key = 'booking_mode';
-- Estas pruebas usan la pasarela; por defecto solo se permiten medios manuales.
update public.app_settings set value = 'bank_transfer,payment_link,gateway' where key = 'allowed_payment_methods';

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

-- Hold + pago + confirmación, como create-booking y el webhook. Devuelve la reserva.
create function pg_temp.book(p_slug text, p_email text, p_in date, p_out date, p_pay text) returns uuid language plpgsql as $$
declare
  v jsonb;
  r uuid;
  total int;
begin
  total := (public.pricing_core((select id from public.properties where slug = p_slug), p_in, p_out, 2) ->> 'total_clp')::int;
  v := public.create_booking_hold(p_slug, p_in, p_out, 2, 'TEST', p_email, '+56911111111', 'Chile',
                                  '{"requested": false}'::jsonb, null, total);
  r := (v ->> 'reservation_id')::uuid;
  if p_pay is not null then
    perform public.attach_payment(r, 'flow', p_pay, total);
    perform public.confirm_payment('flow', p_pay, 'approved', total);
  end if;
  return r;
end;
$$;

-- Desglose congelado de una reserva, en una línea comparable.
create function pg_temp.tax(p_res uuid) returns text language sql as $$
  select coalesce(tax_status, 'null') || '|' || net_total_clp || '|' || vat_clp || '|' || avaluo_rebate_clp
    from public.reservations where id = p_res;
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d date;
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc uuid := gen_random_uuid();
  o_a uuid; o_b uuid; o_c uuid;
  g_a uuid; g_b uuid; g_b2 uuid; g_c uuid;
  p uuid; p_b uuid; p_c uuid;
  r uuid; r_b uuid; r_c uuid; r_late uuid; r_hold uuid; r_cancel uuid; r_new uuid;
  frozen_at timestamptz;
  esperado_ok text;
  v jsonb;
begin
  d := hoy + 40;

  -- Dueños: A con IVA y rebaja del avalúo; B sin IVA; C pendiente (contador).
  insert into public.owners (kind, legal_name, rut, vat_applies, apply_avaluo_rebate)
    values ('empresa', 'TEST A', '90000007-3', true, true) returning id into o_a;
  insert into public.owners (kind, legal_name, rut, vat_applies)
    values ('persona_natural', 'TEST B', '90000008-1', false) returning id into o_b;
  insert into public.owners (kind, legal_name, rut, vat_applies)
    values ('persona_natural', 'TEST C', '90000009-K', null) returning id into o_c;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp)
    values (o_a, 'TEST A', 40000, 6000) returning id into g_a;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (o_b, 'TEST B', 30000) returning id into g_b;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (o_b, 'TEST B2', 35000) returning id into g_b2;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (o_c, 'TEST C', 50000) returning id into g_c;
  -- Avalúo 36.500.000 × 11 % / 365 = 11.000 de rebaja por noche.
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, avaluo_fiscal_clp)
    values (o_a, g_a, 'test-mo', 'TEST MO', 'La Huayca', 'publicada', 1, 0, 4, 36500000) returning id into p;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests)
    values (o_b, g_b, 'test-mo-b', 'TEST MO B', 'La Huayca', 'publicada', 1, 0, 4) returning id into p_b;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests)
    values (o_c, g_c, 'test-mo-c', 'TEST MO C', 'La Huayca', 'publicada', 1, 0, 4) returning id into p_c;
  -- Pasarela configurada (Sesión 10b: sin cuenta con pasarela no hay holds por pasarela).
  with a as (insert into public.payment_accounts (owner_id, label, provider, gateway_secret_name, gateway_account_id, gateway_environment)
             values (o_a, 'TEST pasarela', 'flow', 'GATEWAY_TEST_SECRET', 'TEST-MO', 'integration') returning id)
  update public.properties set payment_account_id = (select id from a) where slug in ('test-mo', 'test-mo-b', 'test-mo-c');

  -- ═══ 1. Coherencia dueño/tarifa ═══════════════════════════════════════
  perform pg_temp.rec('Propiedad de A con tarifa de B → rechazado', '23503',
    pg_temp.q(format($s$with x as (update public.properties set rate_group_id = %L where id = %L returning 1) select count(*)::text from x$s$, g_b, p)));
  perform pg_temp.rec('Cambiar solo el dueño (tarifa queda de otro) → rechazado', '23503',
    pg_temp.q(format($s$with x as (update public.properties set owner_id = %L where id = %L returning 1) select count(*)::text from x$s$, o_b, p)));
  perform pg_temp.rec('Nueva propiedad de B con tarifa de A → rechazado', '23503',
    pg_temp.q(format($s$with x as (insert into public.properties (owner_id, rate_group_id, slug, name, city) values (%L, %L, 'test-mo-x', 'XX', 'XX') returning 1) select count(*)::text from x$s$, o_b, g_a)));
  perform pg_temp.rec('Cambiar el dueño de una tarifa en uso → rechazado', '23503',
    pg_temp.q(format($s$with x as (update public.rate_groups set owner_id = %L where id = %L returning 1) select count(*)::text from x$s$, o_b, g_a)));
  perform pg_temp.rec('Propiedad sin tarifa → permitido', '1',
    pg_temp.q(format($s$with x as (insert into public.properties (owner_id, slug, name, city) values (%L, 'test-mo-sin', 'XX', 'XX') returning 1) select count(*)::text from x$s$, o_b)));
  perform pg_temp.rec('  la propiedad de A sigue con su dueño y su tarifa', 'true',
    (select owner_id = o_a and rate_group_id = g_a from public.properties where id = p)::text);

  -- ═══ 2. Desglose congelado al confirmar ═══════════════════════════════
  r := pg_temp.book('test-mo', 'mo-a@test.invalid', d, d + 2, 'pay-mo-a');
  select n.net_clp || '|' || n.vat_clp into esperado_ok from public.vat_extract(86000, 22000) n;
  perform pg_temp.rec('Dueño con IVA: confirmada y desglose congelado (ok|neto|IVA|rebaja)', 'ok|' || esperado_ok || '|22000', pg_temp.tax(r));
  perform pg_temp.rec('  valores esperados (cálculo independiente)', 'ok|75782|10218|22000', pg_temp.tax(r));
  perform pg_temp.rec('  neto + IVA = total pagado', 'true', (select net_total_clp + vat_clp = total_clp from public.reservations where id = r)::text);
  perform pg_temp.rec('  instantánea con la configuración usada', 'true|true|36500000',
    (select (tax_snapshot ->> 'vat_applies') || '|' || (tax_snapshot ->> 'apply_avaluo_rebate') || '|' || (tax_snapshot ->> 'avaluo_fiscal_clp')
       from public.reservations where id = r));
  select tax_frozen_at into frozen_at from public.reservations where id = r;

  -- Un segundo pago aprobado (Sesión 10: abono + saldo) no recongela.
  insert into public.payments (reservation_id, provider, provider_payment_id, kind, status, amount_clp)
    values (r, 'flow', 'pay-mo-a-2', 'cobro', 'pendiente', 86000);
  update public.owners set vat_applies = false where id = o_a;
  v := public.confirm_payment('flow', 'pay-mo-a-2', 'approved', 86000);
  perform pg_temp.rec('Segundo pago aprobado tras cambiar el IVA → no altera el desglose', 'ok|' || esperado_ok || '|22000', pg_temp.tax(r));
  perform pg_temp.rec('  misma fecha de congelamiento', 'true', ((select tax_frozen_at from public.reservations where id = r) = frozen_at)::text);
  update public.reservations set needs_refund = false, refund_reason = null where id = r; -- deja el caso limpio

  -- Cambiar la configuración del dueño después no altera reservas confirmadas.
  perform pg_temp.rec('vat_applies → false: la reserva confirmada no cambia', 'ok|' || esperado_ok || '|22000', pg_temp.tax(r));
  update public.owners set vat_applies = null where id = o_a;
  perform pg_temp.rec('vat_applies → null: la reserva confirmada no cambia', 'ok|' || esperado_ok || '|22000', pg_temp.tax(r));
  update public.owners set vat_applies = false where id = o_a;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('  el desglose interno (cotización) sí usa la configuración nueva', 'exempt|0',
    (select (x ->> 'tax_status') || '|' || (x ->> 'vat_clp') from (select public.internal_tax_breakdown(p, d + 20, d + 22, 2) x) s));
  perform pg_temp.as_postgres();
  update public.owners set vat_applies = true where id = o_a;

  r_b := pg_temp.book('test-mo-b', 'mo-b@test.invalid', d, d + 2, 'pay-mo-b');
  perform pg_temp.rec('Dueño sin IVA → exempt, IVA 0, neto = total', 'exempt|60000|0|0', pg_temp.tax(r_b));
  r_c := pg_temp.book('test-mo-c', 'mo-c@test.invalid', d, d + 2, 'pay-mo-c');
  perform pg_temp.rec('Dueño pendiente (contador) → pending, sin cifras', 'pending|0|0|0', pg_temp.tax(r_c));

  -- Rama "aprobado tarde": también congela.
  r_late := pg_temp.book('test-mo-b', 'mo-late@test.invalid', d + 5, d + 6, null);
  perform public.attach_payment(r_late, 'flow', 'pay-mo-late', 30000);
  update public.reservations set status = 'cancelada', cancellation_reason = 'hold_expirado' where id = r_late;
  v := public.confirm_payment('flow', 'pay-mo-late', 'approved', 30000);
  perform pg_temp.rec('Aprobado tarde → late_confirmed y desglose congelado', 'late_confirmed|exempt|30000|0|0',
    (v ->> 'outcome') || '|' || pg_temp.tax(r_late));
  perform pg_temp.rec('Un hold sin pagar no tiene desglose', 'null',
    coalesce((select tax_status from public.reservations where id = pg_temp.book('test-mo-b', 'mo-h@test.invalid', d + 8, d + 9, null)), 'null'));

  -- El público nunca ve neto, IVA ni estado tributario.
  perform pg_temp.rec('Estado público sin neto/IVA/tax', '0',
    (select count(*)::text from jsonb_object_keys(public.public_booking_status((select public_code from public.reservations where id = r))) k
      where k ~* 'net|vat|iva|tax|impuesto|rebate'));

  -- ═══ 3. Cambio de dueño seguro ════════════════════════════════════════
  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-mo@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST Encargado MO');

  -- Reservas de A en la propiedad: r (confirmada, futura), una en hold y una cancelada.
  r_hold := pg_temp.book('test-mo', 'mo-hold@test.invalid', d + 10, d + 11, null);
  r_cancel := pg_temp.book('test-mo', 'mo-cancel@test.invalid', d + 12, d + 13, null);
  update public.reservations set status = 'cancelada', cancellation_reason = 'test' where id = r_cancel;

  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: change_property_owner', 'denegado',
    pg_temp.q(format($s$select public.change_property_owner(%L, %L, %L)::text$s$, p, o_b, g_b)));
  perform pg_temp.rec('Anon: lee el historial', 'denegado', pg_temp.q($s$select count(*)::text from public.property_owner_changes$s$));
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: change_property_owner', 'denegado',
    pg_temp.q(format($s$select public.change_property_owner(%L, %L, %L)::text$s$, p, o_b, g_b)));
  perform pg_temp.as_role('authenticated', gen_random_uuid());
  perform pg_temp.rec('Autenticado sin rol: change_property_owner', 'denegado',
    pg_temp.q(format($s$select public.change_property_owner(%L, %L, %L)::text$s$, p, o_b, g_b)));
  perform pg_temp.as_postgres();
  perform pg_temp.rec('  la propiedad no cambió', 'true', (select owner_id = o_a from public.properties where id = p)::text);

  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Admin con tarifa de un tercero → rechazado', '23503',
    pg_temp.q(format($s$select public.change_property_owner(%L, %L, %L)::text$s$, p, o_b, g_a)));
  perform pg_temp.as_postgres();
  perform pg_temp.rec('  sin cambios parciales (dueño y tarifa intactos, sin historial)', 'true|0',
    (select (owner_id = o_a and rate_group_id = g_a)::text from public.properties where id = p) || '|' ||
    (select count(*) from public.property_owner_changes where property_id = p));

  perform pg_temp.as_role('authenticated', v_admin);
  v := public.change_property_owner(p, o_b, g_b2, '  Venta de la cabaña a B  ');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Admin cambia dueño y tarifa juntos', 'true|true',
    (v ->> 'ok') || '|' || (select (owner_id = o_b and rate_group_id = g_b2)::text from public.properties where id = p));
  perform pg_temp.rec('  reservas futuras que quedan con el dueño anterior (confirmada + hold)', '2',
    v ->> 'future_reservations_previous_owner');
  perform pg_temp.rec('  dueño anterior informado', o_a::text, v ->> 'previous_owner_id');
  perform pg_temp.rec('  las reservas existentes conservan su dueño', 'true',
    (select bool_and(owner_id = o_a) from public.reservations where id in (r, r_hold, r_cancel))::text);
  perform pg_temp.rec('  el desglose congelado no cambia', 'ok|' || esperado_ok || '|22000', pg_temp.tax(r));
  perform pg_temp.rec('  historial con nota y autor', 'Venta de la cabaña a B|true|true',
    (select note || '|' || (changed_by = v_admin)::text || '|' || (previous_owner_id = o_a and new_owner_id = o_b and previous_rate_group_id = g_a)::text
       from public.property_owner_changes where property_id = p));

  -- Las reservas nuevas toman el dueño nuevo y su configuración (sin IVA).
  update public.reservations set status = 'cancelada', cancellation_reason = 'test' where id = r_hold;
  r_new := pg_temp.book('test-mo', 'mo-new@test.invalid', d + 20, d + 21, 'pay-mo-new');
  perform pg_temp.rec('Reserva nueva → dueño nuevo, tarifa nueva y su desglose', 'true|exempt|35000|0|0',
    (select (owner_id = o_b)::text from public.reservations where id = r_new) || '|' || pg_temp.tax(r_new));

  perform pg_temp.as_role('authenticated', v_admin);
  v := public.change_property_owner(p, o_a, null);
  perform pg_temp.rec('Admin deja la propiedad sin tarifa (dueño A)', 'true|true',
    (v ->> 'ok') || '|' || (select (owner_id = o_a and rate_group_id is null)::text from public.properties where id = p));
  perform pg_temp.rec('  futuras con el dueño anterior (B): 1', '1', v ->> 'future_reservations_previous_owner');
  perform pg_temp.rec('Admin lee el historial', '2', pg_temp.q(format($s$select count(*)::text from public.property_owner_changes where property_id = %L$s$, p)));
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado lee el historial → 0 filas', '0', pg_temp.q($s$select count(*)::text from public.property_owner_changes$s$));
  perform pg_temp.as_postgres();
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
