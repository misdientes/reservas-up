-- SEED SOLO PARA LA BASE LOCAL (npx supabase db reset). `db push` no lo
-- aplica a producción. Datos ficticios de ejemplo, sin datos reales.

-- Entorno local: habilita el proveedor de pago simulado (ver
-- payments_guard_mock) y el modo de reserva online para la demo.
insert into public.app_settings (key, value, is_public) values ('environment', 'local', false)
on conflict (key) do update set value = excluded.value;
update public.app_settings set value = 'online' where key = 'booking_mode';
update public.app_settings set value = '56900000000' where key = 'whatsapp_number';

-- La copia local no debe llamar a la Edge Function de producción.
select cron.unschedule('ical-import') where exists (select 1 from cron.job where jobname = 'ical-import');
-- El worker de correos de la migración apunta a producción: en local se llama a mano (Mailpit).
select cron.unschedule('email-worker') where exists (select 1 from cron.job where jobname = 'email-worker');
update public.app_settings set value = 'reservas@local.test' where key = 'email_from_address';
update public.app_settings set value = 'admin@local.test' where key = 'admin_email';

-- Admin de prueba (solo local; sin contraseña: no se usa para iniciar sesión).
-- Auth exige texto vacío (no NULL) en las columnas de tokens para poder
-- enviar el enlace mágico del panel (correo en Mailpit: http://127.0.0.1:54324).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'admin@local.test', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{}',
        '', '', '', '', '', '', '', '');
insert into public.app_users (id, role, full_name) values ('00000000-0000-4000-8000-00000000a001', 'admin', 'Admin local');

-- Propiedades de ejemplo (las mismas de los fixtures del frontend).
insert into public.owners (id, kind, legal_name, rut, vat_applies, apply_avaluo_rebate)
values ('00000000-0000-4000-8000-0000000000b1', 'empresa', 'Ejemplo SpA', 'EJEMPLO-1', true, false);

insert into public.rate_groups (id, owner_id, name, base_nightly_gross_clp, weekend_nightly_gross_clp, cleaning_fee_gross_clp, included_guests, extra_guest_gross_clp)
values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'Ejemplo costa', 40000, 45000, 6000, 2, 10000),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1', 'Ejemplo centro', 35000, null, 6000, 2, 10000);

insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, weekend_nightly_gross_clp, min_nights)
values ('00000000-0000-4000-8000-0000000000c1', 'Verano', daterange(current_date + 20, current_date + 41), 55000, 60000, 3);

insert into public.properties (
  id, owner_id, rate_group_id, slug, name, description, city, region, neighborhood,
  max_guests, bedrooms, beds, bathrooms, amenities, house_rules, check_in_time, check_out_time,
  min_nights, min_advance_hours, status, management_model, property_type, self_check_in
)
values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1',
   'ejemplo-departamento-costero', 'Ejemplo · Departamento costero',
   E'Texto de ejemplo. Departamento ficticio frente al mar para probar el checkout en local.\nEste párrafo también es de ejemplo.',
   'Iquique', 'Tarapacá', 'Sector de ejemplo', 4, 2, 2, 1,
   array['Wifi', 'Cocina equipada', 'Lavadora', 'Estacionamiento', 'Ropa de cama', 'Toallas', 'Agua caliente', 'Televisor'],
   E'Ejemplo: no se permiten fiestas ni eventos.\nEjemplo: no se fuma dentro del departamento.', '15:00', '11:00',
   2, 24, 'publicada', 'directo', 'departamento', true),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c2',
   'ejemplo-departamento-centro', 'Ejemplo · Departamento en el centro',
   'Texto de ejemplo. Departamento ficticio en el centro de la ciudad.',
   'Santiago', 'Metropolitana', 'Sector de ejemplo', 2, 1, 1, 1, array['Wifi', 'Cocina equipada'],
   null, '15:00', '11:00', 1, 24, 'publicada', 'directo', 'departamento', false),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000b1', null,
   'ejemplo-cabana-pampa', 'Ejemplo · Cabaña en la pampa', null,
   'La Huayca', 'Tarapacá', null, 6, 3, null, 0, '{}', null, null, null, 2, 24, 'publicada', 'directo', 'cabana', true);

-- Algunas noches ocupadas de ejemplo en el departamento costero.
insert into public.calendar_occupancies (property_id, stay, kind, note)
values
  ('00000000-0000-4000-8000-0000000000d1', daterange(current_date + 4, current_date + 7), 'manual_block', 'Ejemplo'),
  ('00000000-0000-4000-8000-0000000000d1', daterange(current_date + 12, current_date + 15), 'manual_block', 'Ejemplo');

-- Cuenta de cobro FICTICIA (Sesión 10a): solo para probar transferencias en
-- local. Los datos reales se cargan en producción desde privado/.
insert into public.payment_accounts (id, owner_id, label, bank_name, account_type, account_number, holder_name, holder_rut, holder_email)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1', 'Cuenta de ejemplo',
        'Banco de Ejemplo', 'Cuenta corriente', '00-000-00000-0', 'Ejemplo SpA', '11.111.111-1', 'pagos@ejemplo.invalid');
update public.properties set payment_account_id = '00000000-0000-4000-8000-0000000000e1'
 where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3');

-- En local también se prueba la pasarela simulada (mock).
update public.app_settings set value = 'bank_transfer,payment_link,gateway' where key = 'allowed_payment_methods';

-- Pasarela (Sesión 10b), solo local: la cuenta de ejemplo usa la pasarela
-- simulada; una segunda cuenta TUU de prueba (clave aleatoria en el .env
-- local) sirve para los callbacks firmados de scripts/test-gateway.mjs.
update public.payment_accounts set provider = 'mock', gateway_secret_name = 'MOCK_WEBHOOK_SECRET'
 where id = '00000000-0000-4000-8000-0000000000e1';
insert into public.payment_accounts (id, owner_id, label, provider, gateway_account_id, gateway_environment, gateway_secret_name)
values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000b1', 'Cuenta TUU de prueba (local)', 'tuu',
        'LOCAL-TUU-TEST', 'integration', 'TUU_LOCAL_TEST_SECRET');
