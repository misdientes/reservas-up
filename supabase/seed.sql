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

-- Admin de prueba (solo local; sin contraseña: no se usa para iniciar sesión).
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@local.test');
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
