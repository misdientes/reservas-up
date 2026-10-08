-- Checkout y hold (Sesión 9): creación del hold, límites, revalidación,
-- precio del servidor, confirmación idempotente y casos de pago tardío.
-- Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/checkout.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)
-- La concurrencia real (dos peticiones a la vez) se prueba por HTTP en
-- scripts/test-checkout.mjs contra la pila local.

begin;

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

create function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  perform set_config('role', p_role, true);
end;
$$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Total del motor para la propiedad de prueba (lo que mostraría la ficha).
create function pg_temp.total(p_in date, p_out date, p_guests int default 2) returns int language sql as $$
  select (public.pricing_core((select id from public.properties where slug = 'test-co'), p_in, p_out, p_guests) ->> 'total_clp')::int;
$$;

-- Crear un hold como lo haría create-booking (con el total correcto).
create function pg_temp.hold(p_email text, p_in date, p_out date, p_ip text default null, p_name text default 'TEST', p_phone text default '+56911111111')
returns jsonb language sql as $$
  select public.create_booking_hold('test-co', p_in, p_out, 2, p_name, p_email, p_phone, 'Chile',
                                    '{"requested": false}'::jsonb, p_ip, pg_temp.total(p_in, p_out));
$$;

create function pg_temp.occ(p_res uuid) returns text language sql as $$
  select coalesce((select kind || '/' || status from public.calendar_occupancies where reservation_id = p_res), 'ninguna');
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d date;
  o uuid; grp uuid; p uuid; cal uuid;
  v jsonb; r uuid; r2 uuid; code text;
  conf_at timestamptz;
  n_res int;
begin
  d := hoy + 30;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST', 'TEST-CO', true) returning id into o;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp) values (o, 'TEST', 40000, 6000) returning id into grp;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests)
    values (o, grp, 'test-co', 'TEST CO', 'Iquique', 'publicada', 1, 0, 4) returning id into p;

  -- ═══ Flujo feliz: hold → aprobado → confirmada ════════════════════════
  v := pg_temp.hold('feliz@test.invalid', d, d + 2);
  r := (v ->> 'reservation_id')::uuid;
  perform pg_temp.rec('Hold creado', 'true', v ->> 'ok');
  perform pg_temp.rec('  total del servidor (2×40.000 + aseo)', '86000', v ->> 'total_clp');
  perform pg_temp.rec('  fechas ocupadas por el hold', 'hold/active', pg_temp.occ(r));
  perform pg_temp.rec('  código público largo (32 hex)', 'true', ((v ->> 'public_code') ~ '^[0-9a-f]{32}$')::text);
  perform pg_temp.rec('  consentimiento: 3 documentos y fecha', 'true',
    (select terms_document_id is not null and privacy_document_id is not null and cancellation_document_id is not null and consent_at is not null
       from public.reservations where id = r)::text);
  perform pg_temp.rec('  política congelada: límite = llegada − 5 días', (d - 5)::text,
    (select cancellation_policy ->> 'free_until' from public.reservations where id = r));
  perform public.attach_payment(r, 'flow', 'pay-feliz', 86000);
  v := public.confirm_payment('flow', 'pay-feliz', 'approved', 86000);
  perform pg_temp.rec('Pago aprobado → confirmada', 'confirmed|confirmada', (v ->> 'outcome') || '|' || (select status::text from public.reservations where id = r));
  perform pg_temp.rec('  las fechas nunca se liberaron (misma ocupación)', 'reservation/active', pg_temp.occ(r));
  select confirmed_at into conf_at from public.reservations where id = r;

  -- ═══ Webhook repetido 3 veces ═════════════════════════════════════════
  v := public.confirm_payment('flow', 'pay-feliz', 'approved', 86000);
  v := public.confirm_payment('flow', 'pay-feliz', 'approved', 86000);
  perform pg_temp.rec('Webhook ×3 → ya procesado', 'already_processed', v ->> 'outcome');
  perform pg_temp.rec('  1 solo pago y 1 sola confirmación', '1|true',
    (select count(*) from public.payments where reservation_id = r) || '|' ||
    ((select confirmed_at from public.reservations where id = r) = conf_at)::text);

  -- ═══ Rechazo → hold liberado ══════════════════════════════════════════
  v := pg_temp.hold('rechazo@test.invalid', d + 3, d + 5);
  r := (v ->> 'reservation_id')::uuid;
  perform public.attach_payment(r, 'flow', 'pay-rechazo', (v ->> 'total_clp')::int);
  v := public.confirm_payment('flow', 'pay-rechazo', 'rejected', null);
  perform pg_temp.rec('Rechazo → hold liberado', 'released|cancelada|cancelled',
    (v ->> 'outcome') || '|' || (select status::text from public.reservations where id = r) || '|' || split_part(pg_temp.occ(r), '/', 2));
  perform pg_temp.rec('  las fechas vuelven a estar disponibles', 'true', (pg_temp.hold('otra@test.invalid', d + 3, d + 5) ->> 'ok'));

  -- ═══ Pago aprobado tarde ══════════════════════════════════════════════
  v := pg_temp.hold('tarde1@test.invalid', d + 7, d + 9);
  r := (v ->> 'reservation_id')::uuid;
  perform public.attach_payment(r, 'flow', 'pay-tarde-libre', (v ->> 'total_clp')::int);
  update public.reservations set status = 'cancelada', cancellation_reason = 'hold_expirado' where id = r; -- como el job
  v := public.confirm_payment('flow', 'pay-tarde-libre', 'approved', (select total_clp from public.reservations where id = r));
  perform pg_temp.rec('Aprobado tarde con fechas libres → confirmada', 'late_confirmed|confirmada|reservation/active',
    (v ->> 'outcome') || '|' || (select status::text from public.reservations where id = r) || '|' || pg_temp.occ(r));

  v := pg_temp.hold('tarde2@test.invalid', d + 10, d + 12);
  r := (v ->> 'reservation_id')::uuid;
  perform public.attach_payment(r, 'flow', 'pay-tarde-tomada', (v ->> 'total_clp')::int);
  update public.reservations set status = 'cancelada', cancellation_reason = 'hold_expirado' where id = r;
  r2 := (pg_temp.hold('ganador@test.invalid', d + 10, d + 12) ->> 'reservation_id')::uuid; -- otro tomó las fechas
  v := public.confirm_payment('flow', 'pay-tarde-tomada', 'approved', (select total_clp from public.reservations where id = r));
  perform pg_temp.rec('Aprobado tarde con fechas tomadas → needs_refund', 'needs_refund|true|cancelada',
    (v ->> 'outcome') || '|' || (select needs_refund::text from public.reservations where id = r) || '|' || (select status::text from public.reservations where id = r));
  perform pg_temp.rec('  incidente registrado', 'late_approval_unavailable',
    (select string_agg(kind, ',') from public.payment_incidents where reservation_id = r));
  perform pg_temp.rec('  el otro huésped conserva sus fechas', 'hold/active', pg_temp.occ(r2));

  -- ═══ Monto alterado ═══════════════════════════════════════════════════
  v := pg_temp.hold('monto@test.invalid', d + 13, d + 15);
  r := (v ->> 'reservation_id')::uuid;
  perform public.attach_payment(r, 'flow', 'pay-monto', (v ->> 'total_clp')::int);
  v := public.confirm_payment('flow', 'pay-monto', 'approved', 1000);
  perform pg_temp.rec('Monto distinto → no confirma', 'amount_mismatch|cancelada|true',
    (v ->> 'outcome') || '|' || (select status::text from public.reservations where id = r) || '|' || (select needs_refund::text from public.reservations where id = r));
  perform pg_temp.rec('  attach_payment rechaza un cobro distinto al total', '22023',
    pg_temp.q(format($s$select public.attach_payment(%L, 'flow', 'pay-x', 1)::text$s$, (pg_temp.hold('x@test.invalid', d + 16, d + 18) ->> 'reservation_id'))));

  -- ═══ Choque abierto de tipo hold → no se cobra ════════════════════════
  insert into public.external_calendars (property_id, channel, import_url, last_success_at) values (p, 'airbnb', 'https://www.airbnb.cl/t.ics', now()) returning id into cal;
  v := pg_temp.hold('choque@test.invalid', d + 20, d + 22);
  r := (v ->> 'reservation_id')::uuid;
  insert into public.calendar_conflicts (property_id, external_calendar_id, external_uid, rejected_stay, conflicting_occupancy_id, reservation_id, conflict_type)
    values (p, cal, 'airbnb-uid', daterange(d + 20, d + 22), (select id from public.calendar_occupancies where reservation_id = r), r, 'hold');
  v := public.assert_hold_chargeable(r);
  perform pg_temp.rec('Choque tipo hold antes de cobrar → no se cobra', 'conflict_hold|cancelada',
    (v ->> 'reason') || '|' || (select status::text from public.reservations where id = r));

  v := pg_temp.hold('choque2@test.invalid', d + 23, d + 25);
  r := (v ->> 'reservation_id')::uuid;
  perform public.attach_payment(r, 'flow', 'pay-choque', (v ->> 'total_clp')::int);
  insert into public.calendar_conflicts (property_id, external_calendar_id, external_uid, rejected_stay, conflicting_occupancy_id, reservation_id, conflict_type)
    values (p, cal, 'airbnb-uid-2', daterange(d + 23, d + 25), (select id from public.calendar_occupancies where reservation_id = r), r, 'hold');
  v := public.confirm_payment('flow', 'pay-choque', 'approved', (select total_clp from public.reservations where id = r));
  perform pg_temp.rec('Choque tipo hold al confirmar → needs_refund', 'needs_refund|true', (v ->> 'outcome') || '|' || (select needs_refund::text from public.reservations where id = r));

  -- ═══ Revalidación con los canales (regla 3) ═══════════════════════════
  update public.external_calendars set last_success_at = now() - interval '20 minutes' where id = cal;
  v := pg_temp.hold('stale@test.invalid', d + 26, d + 28);
  perform pg_temp.rec('Última sincronización exitosa hace 20 min → no hay hold', 'sync_stale', v ->> 'reason');
  update public.external_calendars set last_success_at = now() - interval '5 minutes' where id = cal;
  perform pg_temp.rec('Hace 5 min → sí', 'true', pg_temp.hold('fresh@test.invalid', d + 26, d + 28) ->> 'ok');

  -- ═══ Límite de holds activos ══════════════════════════════════════════
  perform pg_temp.hold('limite@test.invalid', d + 40, d + 41);
  perform pg_temp.hold('limite@test.invalid', d + 42, d + 43);
  perform pg_temp.rec('3.er hold del mismo email → límite', 'hold_limit', pg_temp.hold('LIMITE@test.invalid ', d + 44, d + 45) ->> 'reason');
  perform pg_temp.hold('ip1@test.invalid', d + 46, d + 47, 'ip-hash-1');
  perform pg_temp.hold('ip2@test.invalid', d + 48, d + 49, 'ip-hash-1');
  perform pg_temp.rec('3.er hold de la misma IP → límite', 'hold_limit', pg_temp.hold('ip3@test.invalid', d + 50, d + 51, 'ip-hash-1') ->> 'reason');

  -- ═══ Precio: siempre del servidor ═════════════════════════════════════
  select count(*) into n_res from public.reservations;
  v := public.create_booking_hold('test-co', d + 60, d + 62, 2, 'TEST', 'precio@test.invalid', null, 'Chile', '{"requested": false}', null, 1);
  perform pg_temp.rec('Total esperado distinto → price_changed con el total real', 'price_changed|86000', (v ->> 'reason') || '|' || (v ->> 'total_clp'));
  perform pg_temp.rec('  no se creó ningún hold', '0', ((select count(*) from public.reservations) - n_res)::text);
  v := public.create_booking_hold('test-co', d + 60, d + 62, 2, 'TEST', 'precio@test.invalid', null, 'Chile', '{"requested": false}', null, 86000);
  perform pg_temp.rec('Total esperado igual → hold con el total del motor', '86000', (select total_clp::text from public.reservations where id = (v ->> 'reservation_id')::uuid));

  -- ═══ Fechas ya tomadas / no cotizables ════════════════════════════════
  perform pg_temp.rec('Fechas de una reserva confirmada → unavailable', 'unavailable', pg_temp.hold('tarde@test.invalid', d, d + 2) ->> 'reason');
  perform pg_temp.rec('Mínimo de noches/fechas inválidas → motivo del motor', 'invalid_dates',
    public.create_booking_hold('test-co', d + 5, d + 5, 2, 'T', 'm@test.invalid', null, null, '{}', null, 0) ->> 'reason');
  perform pg_temp.rec('Propiedad no publicada → not_found', 'not_found',
    public.create_booking_hold('no-existe', d, d + 2, 2, 'T', 'm@test.invalid', null, null, '{}', null, 0) ->> 'reason');

  -- ═══ Huésped recurrente: 1 huésped, copia de contacto por reserva ═════
  v := pg_temp.hold('recurrente@test.invalid', d + 70, d + 71, null, 'Ana Original', '+56911110001');
  r := (v ->> 'reservation_id')::uuid;
  v := pg_temp.hold(' Recurrente@Test.Invalid', d + 72, d + 73, null, 'Ana Cambiada', '+56922220002');
  r2 := (v ->> 'reservation_id')::uuid;
  perform pg_temp.rec('Mismo email (otra mayúscula/espacio) → 1 huésped', '1',
    (select count(*)::text from public.guests where email_normalized = 'recurrente@test.invalid'));
  perform pg_temp.rec('  2 reservas del mismo huésped', 'true',
    ((select guest_id from public.reservations where id = r) = (select guest_id from public.reservations where id = r2))::text);
  perform pg_temp.rec('  el huésped conserva sus datos originales', 'Ana Original|+56911110001',
    (select full_name || '|' || phone from public.guests where email_normalized = 'recurrente@test.invalid'));
  perform pg_temp.rec('  cada reserva tiene su copia de contacto', 'Ana Original +56911110001 / Ana Cambiada +56922220002',
    (select contact_name || ' ' || contact_phone from public.reservations where id = r) || ' / ' ||
    (select contact_name || ' ' || contact_phone from public.reservations where id = r2));

  -- ═══ Factura opcional ═════════════════════════════════════════════════
  v := public.create_booking_hold('test-co', d + 80, d + 81, 2, 'Empresa', 'factura@test.invalid', null, 'Chile',
    '{"requested": true, "rut": "76.086.428-5", "business_name": "Empresa de Prueba SpA", "activity": "Servicios", "address": "Calle 1, Iquique"}',
    null, pg_temp.total(d + 80, d + 81));
  perform pg_temp.rec('Factura: se guardan los datos con la reserva', 'true|Empresa de Prueba SpA',
    (select invoice_requested::text || '|' || invoice_business_name from public.reservations where id = (v ->> 'reservation_id')::uuid));

  -- ═══ Proveedor simulado: solo en local ════════════════════════════════
  perform pg_temp.rec('Pago con proveedor mock',
    case when (select value from public.app_settings where key = 'environment') = 'local' then 'aceptado' else 'denegado' end,
    case pg_temp.q(format($s$with x as (insert into public.payments (reservation_id, provider, provider_payment_id, amount_clp) values (%L, 'mock', 'mock-x', 1000) returning 1) select count(*)::text from x$s$, r))
      when '1' then 'aceptado' else 'denegado' end);

  -- ═══ Estado público y permisos ════════════════════════════════════════
  code := (select public_code from public.reservations where contact_email = 'feliz@test.invalid');
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: estado de una reserva por su código', 'confirmada',
    pg_temp.q(format($s$select public.public_booking_status(%L) ->> 'status'$s$, code)));
  perform pg_temp.rec('  sin email ni teléfono en la respuesta', 'false',
    pg_temp.q(format($s$select (public.public_booking_status(%L)::text ~* '(@|\+569|contact|email|phone)')::text$s$, code)));
  perform pg_temp.rec('  código inválido → nada', 'null', pg_temp.q($s$select public.public_booking_status('abc')::text$s$));
  perform pg_temp.rec('Anon: create_booking_hold', 'denegado',
    pg_temp.q($s$select public.create_booking_hold('test-co', current_date + 90, current_date + 92, 2, 'x', 'x@x.cl', null, null, '{}', null, 0)::text$s$));
  perform pg_temp.rec('Anon: confirm_payment', 'denegado', pg_temp.q($s$select public.confirm_payment('flow', 'x', 'approved', 1)::text$s$));
  perform pg_temp.rec('Anon: attach_payment', 'denegado', pg_temp.q(format($s$select public.attach_payment(%L, 'flow', 'x', 1)::text$s$, r)));
  perform pg_temp.rec('Anon: payment_incidents', 'denegado', pg_temp.q($s$select count(*)::text from public.payment_incidents$s$));
  perform pg_temp.as_postgres();
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
