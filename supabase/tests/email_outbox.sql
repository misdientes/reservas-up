-- Correos transaccionales (Sesión 11): cada evento encola sus correos en la
-- misma transacción, una sola vez (clave única); programación en hora de
-- Chile; worker con reintentos, backoff y recuperación de atascados;
-- datos privados (llegada, código de acceso) nunca públicos.
-- Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/email_outbox.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)

begin;

-- Holds solo en modo 'online' (producción: 'whatsapp'); todo se revierte.
update public.app_settings set value = 'online' where key = 'booking_mode';
update public.app_settings set value = 'bank_transfer,payment_link' where key = 'allowed_payment_methods';
update public.app_settings set value = 'admin-test@test.invalid' where key = 'admin_email';
-- Los correos reales que hubiera en la cola no participan de la prueba.
update public.email_outbox set send_after = send_after + interval '100 years' where status = 'pendiente';

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

create function pg_temp.mhold(p_slug text, p_email text, p_in date, p_out date,
                              p_method text default 'bank_transfer', p_plan text default 'deposit')
returns uuid language sql as $$
  select (public.create_booking_hold(p_slug, p_in, p_out, 2, 'Ana Test', p_email, '+56911111111', 'Chile',
           '{"requested": false}'::jsonb, null,
           (public.pricing_core((select id from public.properties where slug = p_slug), p_in, p_out, 2) ->> 'total_clp')::int,
           p_method, p_plan) ->> 'reservation_id')::uuid;
$$;

-- Plantillas encoladas para una reserva, en orden.
create function pg_temp.mails(p_res uuid) returns text language sql as $$
  select coalesce(string_agg(template_key, ',' order by template_key), '')
    from public.email_outbox where reservation_id = p_res;
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d date;
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc uuid := gen_random_uuid();
  o uuid; g uuid; acc uuid; p uuid; cal uuid;
  r uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; rp uuid; gp uuid;
  dep int; tot int;
  e uuid;
  v jsonb;
  n_before int;
begin
  d := hoy + 60;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST EM', 'TEST-EM', true) returning id into o;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp) values (o, 'TEST EM', 40000, 6000) returning id into g;
  insert into public.payment_accounts (owner_id, label, bank_name, account_type, account_number, holder_name, holder_rut, holder_email)
    values (o, 'TEST', 'Banco TEST', 'Cuenta corriente', 'TEST-777', 'TEST EM', '11.111.111-1', 'pagos@test.invalid') returning id into acc;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, check_in_time, check_out_time, payment_account_id, address)
    values (o, g, 'test-em', 'TEST EM', 'Iquique', 'publicada', 1, 0, 4, '15:00', '11:00', acc, 'Calle Test 123, depto 4') returning id into p;
  insert into public.property_arrival_info (property_id, access_instructions, wifi_name, wifi_password, parking)
    values (p, 'Caja de llaves junto a la puerta', 'TEST-WIFI', 'clave-test', 'Estacionamiento 12');

  -- ═══ 1. Reserva creada: huésped + admin, en la misma transacción ══════
  r := pg_temp.mhold('test-em', 'em1@test.invalid', d, d + 3);
  perform pg_temp.rec('Hold manual → correo al huésped y al admin', 'admin_new_booking,guest_booking_created', pg_temp.mails(r));
  perform pg_temp.rec('  destinatarios: huésped y admin de app_settings', 'em1@test.invalid|admin-test@test.invalid',
    (select to_email from public.email_outbox where reservation_id = r and template_key = 'guest_booking_created') || '|' ||
    (select to_email from public.email_outbox where reservation_id = r and template_key = 'admin_new_booking'));
  select deposit_required_clp, total_clp into dep, tot from public.reservations where id = r;

  -- ═══ 2. Abono → pago recibido + recordatorio 24 h antes (hora Chile) ═══
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r, 'bank_transfer', dep, 'TEST-EM-1');
  perform public.register_manual_payment(r, 'bank_transfer', dep, 'TEST-EM-1'); -- repetido: idempotente
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Abono → pago recibido + recordatorio de saldo (sin duplicar)',
    'admin_new_booking,guest_balance_reminder,guest_booking_created,guest_payment_received', pg_temp.mails(r));
  perform pg_temp.rec('  recordatorio = vencimiento del saldo − 24 h en hora de Chile', 'true',
    ((select send_after from public.email_outbox where reservation_id = r and template_key = 'guest_balance_reminder') =
     (select ((balance_due_at at time zone 'America/Santiago') - interval '24 hours') at time zone 'America/Santiago'
        from public.reservations where id = r))::text);
  perform pg_temp.rec('  el correo de pago lleva el monto del abono', dep::text,
    (select payload ->> 'amount_clp' from public.email_outbox where reservation_id = r and template_key = 'guest_payment_received'));

  -- ═══ 3. Saldo → pago recibido + llegada 3 días antes (pagó > 7 días antes)
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r, 'bank_transfer', tot - dep, 'TEST-EM-2');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Saldo → 2 correos de pago y 1 de llegada', '2|1',
    (select count(*) from public.email_outbox where reservation_id = r and template_key = 'guest_payment_received') || '|' ||
    (select count(*) from public.email_outbox where reservation_id = r and template_key = 'guest_arrival_info'));
  perform pg_temp.rec('  llegada programada 3 días antes (hora de Chile)', 'true',
    ((select send_after from public.email_outbox where reservation_id = r and template_key = 'guest_arrival_info') =
     ((d - 3) + time '15:00') at time zone 'America/Santiago')::text);
  e := (select id from public.email_outbox where reservation_id = r and template_key = 'guest_balance_reminder');
  perform pg_temp.rec('  recordatorio de un saldo ya pagado → se omite al enviar', 'saldo_pagado_o_vencido', public.email_context(e) ->> 'skip');

  -- Pago completo cerca de la llegada → instrucciones de inmediato.
  r2 := pg_temp.mhold('test-em', 'em2@test.invalid', hoy + 4, hoy + 5, 'bank_transfer', 'full');
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r2, 'bank_transfer', (select total_clp from public.reservations where id = r2), 'TEST-EM-3');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Pago completo a menos de 7 días → llegada de inmediato, sin recordatorio', 'true|0',
    ((select send_after from public.email_outbox where reservation_id = r2 and template_key = 'guest_arrival_info') <= now())::text || '|' ||
    (select count(*) from public.email_outbox where reservation_id = r2 and template_key = 'guest_balance_reminder'));

  -- ═══ 4. Contexto al enviar: datos bancarios y llegada ═════════════════
  e := (select id from public.email_outbox where reservation_id = r and template_key = 'guest_booking_created');
  v := public.email_context(e);
  perform pg_temp.rec('Reserva creada ya pagada → se omite al enviar', 'ya_no_espera_pago', v ->> 'skip');
  r3 := pg_temp.mhold('test-em', 'em3@test.invalid', d + 10, d + 12);
  v := public.email_context((select id from public.email_outbox where reservation_id = r3 and template_key = 'guest_booking_created'));
  perform pg_temp.rec('Contexto de reserva creada: datos bancarios, sin datos de llegada', 'Banco TEST|null|null',
    (v #>> '{vars,bank_name}') || '|' || coalesce(v #>> '{vars,wifi_password}', 'null') || '|' || coalesce(v #>> '{vars,exact_address}', 'null'));
  v := public.email_context((select id from public.email_outbox where reservation_id = r2 and template_key = 'guest_arrival_info'));
  perform pg_temp.rec('Contexto de llegada: dirección exacta, acceso y wifi', 'Calle Test 123, depto 4|Caja de llaves junto a la puerta|clave-test',
    (v #>> '{vars,exact_address}') || '|' || (v #>> '{vars,access_instructions}') || '|' || (v #>> '{vars,wifi_password}'));
  insert into public.message_templates (key, channel, language, subject, body, property_id)
    values ('guest_arrival_info', 'email', 'es', 'Override {{code}}', 'Texto propio', p);
  perform pg_temp.rec('Plantilla propia de la propiedad gana sobre la global', 'Override {{code}}',
    public.email_context((select id from public.email_outbox where reservation_id = r2 and template_key = 'guest_arrival_info')) ->> 'subject');

  -- ═══ 5. Liberada por falta de pago ════════════════════════════════════
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r3;
  perform public.release_expired_holds();
  perform pg_temp.rec('Hold manual vencido → correo de fechas liberadas', 'true',
    (pg_temp.mails(r3) like '%guest_released%')::text);
  r4 := pg_temp.mhold('test-em', 'em4@test.invalid', d + 15, d + 16);
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.release_manual_hold(r4, 'test');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Liberado por el admin → correo de fechas liberadas', 'true', (pg_temp.mails(r4) like '%guest_released%')::text);

  -- ═══ 6. Pago tardío sin fechas → alerta de reembolso al admin ═════════
  r5 := pg_temp.mhold('test-em', 'em5@test.invalid', d + 20, d + 22);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r5;
  perform public.release_expired_holds();
  perform pg_temp.mhold('test-em', 'em5b@test.invalid', d + 20, d + 21);
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r5, 'bank_transfer', (select deposit_required_clp from public.reservations where id = r5), 'TEST-EM-5');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Pago tardío sin fechas → alerta de reembolso, sin "pago recibido"', 'true|0',
    (pg_temp.mails(r5) like '%admin_refund_needed%')::text || '|' ||
    (select count(*) from public.email_outbox where reservation_id = r5 and template_key = 'guest_payment_received'));

  -- ═══ 7. Pasarela: aviso al admin, webhook ×3 → un correo ══════════════
  update public.app_settings set value = 'bank_transfer,payment_link,gateway' where key = 'allowed_payment_methods';
  update public.payment_accounts set provider = 'flow', gateway_secret_name = 'TEST_GATEWAY_SECRET', gateway_account_id = 'TEST-EM', gateway_environment = 'integration' where id = acc;
  r6 := pg_temp.mhold('test-em', 'em6@test.invalid', d + 25, d + 26, 'gateway', 'full');
  perform public.attach_payment(r6, 'flow', 'TEST-EM-GW', (select total_clp from public.reservations where id = r6));
  perform public.confirm_payment('flow', 'TEST-EM-GW', 'approved', (select total_clp from public.reservations where id = r6));
  perform public.confirm_payment('flow', 'TEST-EM-GW', 'approved', (select total_clp from public.reservations where id = r6));
  perform public.confirm_payment('flow', 'TEST-EM-GW', 'approved', (select total_clp from public.reservations where id = r6));
  perform pg_temp.rec('Pasarela ×3 → 1 aviso al admin, 1 pago recibido, 1 llegada; sin "reserva creada"', '1|1|1|0',
    (select count(*) from public.email_outbox where reservation_id = r6 and template_key = 'admin_gateway_payment') || '|' ||
    (select count(*) from public.email_outbox where reservation_id = r6 and template_key = 'guest_payment_received') || '|' ||
    (select count(*) from public.email_outbox where reservation_id = r6 and template_key = 'guest_arrival_info') || '|' ||
    (select count(*) from public.email_outbox where reservation_id = r6 and template_key = 'guest_booking_created'));

  -- ═══ 8. Alertas programadas (idempotentes) ════════════════════════════
  update public.reservations set balance_due_at = now() - interval '1 hour', amount_paid = deposit_required_clp where id = r3; -- (r3 está cancelada: no cuenta)
  r3 := pg_temp.mhold('test-em', 'em7@test.invalid', d + 30, d + 32);
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r3, 'bank_transfer', (select deposit_required_clp from public.reservations where id = r3), 'TEST-EM-7');
  perform pg_temp.as_postgres();
  update public.reservations set balance_due_at = now() - interval '1 hour' where id = r3;
  insert into public.external_calendars (property_id, channel, import_url, last_attempt_at, last_success_at)
    values (p, 'airbnb', 'https://example.invalid/em.ics', now(), now() - interval '2 hours') returning id into cal;
  perform public.enqueue_scheduled_alerts();
  perform public.enqueue_scheduled_alerts();
  perform pg_temp.rec('Saldo vencido → 1 alerta aunque el job corra 2 veces', '1',
    (select count(*)::text from public.email_outbox where reservation_id = r3 and template_key = 'admin_balance_overdue'));
  perform pg_temp.rec('iCal caído → 1 alerta por caída', '1',
    (select count(*)::text from public.email_outbox where template_key = 'admin_sync_alert' and payload ->> 'calendar_id' = cal::text));
  update public.external_calendars set last_success_at = now() - interval '90 minutes' where id = cal; -- se recuperó y volvió a caer
  perform public.enqueue_scheduled_alerts();
  perform pg_temp.rec('  nueva caída → nueva alerta', '2',
    (select count(*)::text from public.email_outbox where template_key = 'admin_sync_alert' and payload ->> 'calendar_id' = cal::text));

  -- ═══ 9. Worker: tomar, reintentos, fallido y atascados ════════════════
  update public.email_outbox set send_after = now() - interval '1 minute' where reservation_id = r2 and template_key = 'guest_payment_received';
  e := (select id from public.email_outbox where reservation_id = r2 and template_key = 'guest_payment_received');
  perform pg_temp.rec('El worker toma el correo listo', 'true', (e in (select id from public.claim_emails(100)))::text);
  perform pg_temp.rec('  queda "enviando", intento 1', 'enviando|1', (select status || '|' || attempts from public.email_outbox where id = e));
  perform public.claim_emails(100);
  perform pg_temp.rec('  no se vuelve a tomar mientras se envía', '1', (select attempts::text from public.email_outbox where id = e));
  update public.email_outbox set claimed_at = now() - interval '11 minutes' where id = e; -- el worker se cortó
  perform public.claim_emails(100);
  perform pg_temp.rec('Atascado > 10 min → se retoma sin sumar un intento extra', 'enviando|1',
    (select status || '|' || attempts from public.email_outbox where id = e));
  perform public.mark_email_result(e, 'error', 'resend 500');
  perform pg_temp.rec('Error → pendiente con backoff de 1 min', 'pendiente|true|resend 500',
    (select status || '|' || (next_attempt_at between now() + interval '55 seconds' and now() + interval '65 seconds') || '|' || last_error
       from public.email_outbox where id = e));
  update public.email_outbox set attempts = 6, status = 'enviando' where id = e;
  perform public.mark_email_result(e, 'error', 'resend 500');
  perform pg_temp.rec('6.º intento fallido → fallido', 'fallido', (select status from public.email_outbox where id = e));
  e := (select id from public.email_outbox where reservation_id = r2 and template_key = 'guest_arrival_info');
  perform public.mark_email_result(e, 'enviado', null, 'msg_test');
  perform pg_temp.rec('Enviado → registra el id del proveedor', 'enviado|msg_test',
    (select status || '|' || provider_message_id from public.email_outbox where id = e));

  -- ═══ 10. Código de acceso después de la llegada ═══════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  v := public.set_reservation_access_code(r2, '4821');
  perform public.set_reservation_access_code(r2, '4821'); -- mismo código: sin correo nuevo
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Código cargado tras enviar la llegada → 1 correo con el código', 'true|1',
    (v ->> 'ok') || '|' || (select count(*) from public.email_outbox where reservation_id = r2 and template_key = 'guest_access_code'));
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.set_reservation_access_code(r2, '9930');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('  código cambiado → otro correo; access_codes guarda el vigente', '2|9930',
    (select count(*) from public.email_outbox where reservation_id = r2 and template_key = 'guest_access_code') || '|' ||
    (select code from public.access_codes where reservation_id = r2));
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.set_reservation_access_code(r, '1111'); -- su llegada aún no se envía
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Código antes de enviar la llegada → va en ese correo, sin correo aparte', '0|1111',
    (select count(*) from public.email_outbox where reservation_id = r and template_key = 'guest_access_code') || '|' ||
    (public.email_context((select id from public.email_outbox where reservation_id = r and template_key = 'guest_arrival_info')) #>> '{vars,access_code}'));

  -- ═══ 12. Antigüedad y condiciones al enviar (sin ráfaga de correos viejos)
  e := (select id from public.email_outbox where reservation_id = r and template_key = 'admin_new_booking');
  update public.email_outbox set created_at = now() - interval '25 hours' where id = e;
  perform pg_temp.rec('Alerta al admin con más de 24 h → omitida al enviar', 'alerta_antigua', public.email_context(e) ->> 'skip');
  update public.email_outbox set created_at = now() - interval '23 hours' where id = e;
  perform pg_temp.rec('  con menos de 24 h → se envía', 'null', coalesce(public.email_context(e) ->> 'skip', 'null'));

  -- El calendario de la sección 8 quedó "caído": sin sincronización fresca no hay
  -- holds (regla anti-doble-reserva n.º 3). Se marca sincronizado para seguir.
  update public.external_calendars set last_success_at = now() where id = cal;
  r7 := pg_temp.mhold('test-em', 'em8@test.invalid', d + 40, d + 41);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r7; -- vencido, el job aún no corre
  perform pg_temp.rec('"Reserva creada" de un hold ya vencido → omitido', 'ya_no_espera_pago',
    public.email_context((select id from public.email_outbox where reservation_id = r7 and template_key = 'guest_booking_created')) ->> 'skip');

  perform pg_temp.rec('Recordatorio cuyo vencimiento ya pasó → omitido (el admin recibe "saldo vencido")', 'saldo_pagado_o_vencido',
    public.email_context((select id from public.email_outbox where reservation_id = r3 and template_key = 'guest_balance_reminder')) ->> 'skip');

  perform pg_temp.rec('Código de acceso reemplazado → el correo del código anterior se omite', 'codigo_reemplazado|null',
    (public.email_context((select id from public.email_outbox where reservation_id = r2 and template_key = 'guest_access_code' and event_key like '%' || md5('4821'))) ->> 'skip') || '|' ||
    coalesce(public.email_context((select id from public.email_outbox where reservation_id = r2 and template_key = 'guest_access_code' and event_key like '%' || md5('9930'))) ->> 'skip', 'null'));

  r8 := pg_temp.mhold('test-em', 'em9@test.invalid', d + 44, d + 45);
  update public.reservations set hold_expires_at = now() - interval '1 minute' where id = r8;
  perform public.release_expired_holds();
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r8, 'bank_transfer', (select deposit_required_clp from public.reservations where id = r8), 'TEST-EM-9');
  perform pg_temp.as_postgres();
  perform pg_temp.rec('"Fechas liberadas" de una reserva recuperada por pago tardío → omitido', 'reserva_recuperada',
    public.email_context((select id from public.email_outbox where reservation_id = r8 and template_key = 'guest_released')) ->> 'skip');

  insert into public.guests (full_name, email) values ('TEST', 'em10@test.invalid') returning id into gp;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, contact_email, total_clp)
    values (p, gp, o, 'confirmada', hoy - 5, hoy - 2, 'em10@test.invalid', 100000) returning id into rp;
  perform public.enqueue_email('res:' || rp || ':arrival_info', 'guest_arrival_info', 'guest', 'em10@test.invalid', rp, p);
  perform pg_temp.rec('Instrucciones de llegada de una estadía ya terminada → omitidas', 'estadia_terminada',
    public.email_context((select id from public.email_outbox where reservation_id = rp and template_key = 'guest_arrival_info')) ->> 'skip');

  update public.reservations set status = 'cancelada', cancellation_reason = 'test' where id = r;
  perform pg_temp.rec('"Pago recibido" de una reserva cancelada después → omitido', 'reserva_no_confirmada',
    public.email_context((select id from public.email_outbox where reservation_id = r and template_key = 'guest_payment_received' limit 1)) ->> 'skip');

  -- ═══ 11. Permisos y privacidad ════════════════════════════════════════
  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-em@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST Encargado EM');
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: email_outbox', 'denegado', pg_temp.q($s$select count(*)::text from public.email_outbox$s$));
  perform pg_temp.rec('Anon: property_arrival_info', 'denegado', pg_temp.q($s$select count(*)::text from public.property_arrival_info$s$));
  perform pg_temp.rec('Anon: set_reservation_access_code', 'denegado', pg_temp.q(format($s$select public.set_reservation_access_code(%L, '1')::text$s$, r)));
  perform pg_temp.rec('Anon: claim_emails', 'denegado', pg_temp.q($s$select count(*)::text from public.claim_emails(1)$s$));
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: email_outbox → 0 filas', '0', pg_temp.q($s$select count(*)::text from public.email_outbox$s$));
  perform pg_temp.rec('Encargado: property_arrival_info → 0 filas', '0', pg_temp.q($s$select count(*)::text from public.property_arrival_info$s$));
  perform pg_temp.rec('Encargado: set_reservation_access_code', 'denegado', pg_temp.q(format($s$select public.set_reservation_access_code(%L, '1')::text$s$, r)));
  perform pg_temp.rec('Encargado: email_context', 'denegado', pg_temp.q(format($s$select public.email_context(%L)::text$s$, e)));
  perform pg_temp.rec('Encargado: admin_upcoming_arrivals', 'denegado', pg_temp.q($s$select count(*)::text from public.admin_upcoming_arrivals()$s$));
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Admin: próximas llegadas con su código', '9930',
    pg_temp.q(format($s$select access_code from public.admin_upcoming_arrivals(14) where reservation_id = %L$s$, r2)));
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Estado público sin datos de llegada ni código', '0',
    (select count(*)::text from jsonb_object_keys(public.public_booking_status((select public_code from public.reservations where id = r2))) k
      where k ~* 'access|wifi|instruction|address|arrival'));
  perform pg_temp.rec('Vistas públicas sin columnas de llegada', '0',
    (select count(*)::text from information_schema.columns
      where table_schema = 'public' and table_name like 'public\_%' and column_name ~* 'wifi|access_instructions|exact_address|access_code'));
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
