-- Matriz de permisos por rol (Sesión 3).
-- Corre contra la base remota sin dejar datos: todo dentro de BEGIN … ROLLBACK.
--   npx supabase db query --linked -f supabase/tests/role_permissions.sql
-- Cada rol se simula con set_config('role') + request.jwt.claims (lo mismo
-- que hace PostgREST con el JWT). Resultado: rol, acción, esperado, obtenido.
-- Convención de "obtenido": un número = filas leídas/afectadas;
-- denegado = sin permiso o rechazado por RLS/función; bloqueado = restricción
-- anti-doble-reserva; sin_columna = la columna no existe en la vista.

begin;

create temp table test_results (
  n        integer generated always as identity,
  rol      text,
  accion   text,
  esperado text,
  obtenido text
) on commit drop;

-- SECURITY DEFINER: registra como postgres aunque el rol simulado no tenga
-- permiso sobre la tabla temporal.
create function pg_temp.rec(p_rol text, p_accion text, p_esperado text, p_obtenido text)
returns void language sql security definer as $$
  insert into test_results (rol, accion, esperado, obtenido) values (p_rol, p_accion, p_esperado, p_obtenido);
$$;

-- Ejecuta una consulta que devuelve un valor y resume el resultado.
create function pg_temp.q(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception
  when insufficient_privilege then return 'denegado';
  when exclusion_violation then return 'bloqueado';
  when undefined_column then return 'sin_columna';
end;
$$;

-- Cambia de rol como lo haría PostgREST. p_sub = id del usuario (null = anon).
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

do $$
declare
  hoy        date := (now() at time zone 'America/Santiago')::date;
  v_admin    uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc      uuid := gen_random_uuid();
  u_prop     uuid := gen_random_uuid();
  u_nada     uuid := gen_random_uuid();
  o_a        uuid;
  o_b        uuid;
  p_a        uuid;
  p_a_draft  uuid;
  p_b        uuid;
  g          uuid;
  r_a        uuid;
  r_a_conf   uuid;
  r_a_cancel uuid;
  r_b        uuid;
  v_block    uuid;
  rol        text;
  props      text := $p$('t-a-pub', 't-a-draft', 't-b-pub')$p$;
begin
  -- ─── Datos de prueba (como postgres; desaparecen con el rollback) ──────
  insert into public.owners (kind, legal_name, rut) values ('empresa', 'TEST Owner A', 'TEST-A') returning id into o_a;
  insert into public.owners (kind, legal_name, rut) values ('persona_natural', 'TEST Owner B', 'TEST-B') returning id into o_b;
  insert into public.properties (owner_id, slug, name, city, neighborhood, address, avaluo_fiscal_clp, status)
    values (o_a, 't-a-pub', 'Test A publicada', 'Iquique', 'Cavancha', 'Calle Secreta 123, depto 45', 80000000, 'publicada')
    returning id into p_a;
  insert into public.properties (owner_id, slug, name, city, address, status)
    values (o_a, 't-a-draft', 'Test A borrador', 'Iquique', 'Calle Borrador 1', 'borrador') returning id into p_a_draft;
  insert into public.properties (owner_id, slug, name, city, address, status)
    values (o_b, 't-b-pub', 'Test B publicada', 'Santiago', 'Calle B 99', 'publicada') returning id into p_b;
  insert into public.property_photos (property_id, storage_path, is_cover) values (p_a, p_a || '/portada.jpg', true);
  insert into public.property_photos (property_id, storage_path, is_cover) values (p_a_draft, p_a_draft || '/portada.jpg', true);
  insert into public.guests (full_name, email, phone, document_number)
    values ('Huésped Prueba', 'huesped@test.invalid', '+56911111111', '11.111.111-1') returning id into g;

  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, total_clp, net_total_clp, vat_clp)
    values (p_a, g, o_a, 'confirmada', hoy + 10, hoy + 13, 300000, 252101, 47899) returning id into r_a;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, total_clp)
    values (p_a, g, o_a, 'conflicto', hoy + 20, hoy + 22, 200000) returning id into r_a_conf;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, total_clp)
    values (p_a, g, o_a, 'confirmada', hoy + 30, hoy + 32, 150000) returning id into r_a_cancel;
  update public.reservations set status = 'cancelada', cancellation_reason = 'cliente' where id = r_a_cancel;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, total_clp)
    values (p_b, g, o_b, 'confirmada', hoy + 10, hoy + 13, 400000) returning id into r_b;
  -- Bloqueo manual contiguo a r_a: la disponibilidad pública debe unirlos.
  insert into public.calendar_occupancies (property_id, stay, kind) values (p_a, daterange(hoy + 13, hoy + 15), 'manual_block');
  -- Ocupaciones en la propiedad en borrador (no deben verse públicamente).
  insert into public.calendar_occupancies (property_id, stay, kind) values (p_a_draft, daterange(hoy + 5, hoy + 8), 'manual_block');

  insert into public.payments (reservation_id, provider, status, amount_clp) values (r_a, 'flow', 'aprobado', 300000);
  insert into public.cleaning_tasks (property_id, reservation_id, scheduled_for) values (p_a, r_a, hoy + 13);
  insert into public.access_codes (property_id, reservation_id, code, valid_from, valid_to)
    values (p_a, r_a, '4321', now(), now() + interval '20 days');
  insert into public.access_codes (property_id, reservation_id, code, valid_from, valid_to)
    values (p_a, r_a_cancel, '9999', now(), now() + interval '40 days');
  insert into public.legal_documents (kind, version, title, content, published_at)
    values ('terminos', 'test-1', 'Términos', 'Texto', now() - interval '1 day');
  insert into public.legal_documents (kind, version, title, content)
    values ('terminos', 'test-2-borrador', 'Términos borrador', 'Texto');

  insert into auth.users (id, instance_id, aud, role, email)
  values (u_enc,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc@test.invalid'),
         (u_prop, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prop@test.invalid'),
         (u_nada, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nada@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST Encargado');
  insert into public.app_users (id, role, full_name, owner_id) values (u_prop, 'propietario', 'TEST Propietario A', o_a);

  insert into storage.objects (bucket_id, name) values ('property-photos', p_a || '/test-existente.jpg');

  -- ═══ PÚBLICO (anon) ═══════════════════════════════════════════════════
  rol := 'anon';
  perform pg_temp.as_role('anon');
  perform pg_temp.rec(rol, 'Ve la propiedad publicada', '1',
    pg_temp.q($s$select count(*) from public.public_properties where slug = 't-a-pub'$s$));
  perform pg_temp.rec(rol, 'NO ve la propiedad en borrador', '0',
    pg_temp.q($s$select count(*) from public.public_properties where slug = 't-a-draft'$s$));
  perform pg_temp.rec(rol, 'Ve comuna/sector (no la dirección)', 'Cavancha',
    pg_temp.q($s$select neighborhood from public.public_properties where slug = 't-a-pub'$s$));
  perform pg_temp.rec(rol, 'Ve tipo de propiedad y llegada autónoma', 'departamento / true',
    pg_temp.q($s$select property_type || ' / ' || self_check_in from public.public_properties where slug = 't-a-pub'$s$));
  perform pg_temp.rec(rol, 'Ve la anticipación mínima (calendario)', '24',
    pg_temp.q($s$select min_advance_hours::text from public.public_properties where slug = 't-a-pub'$s$));
  perform pg_temp.rec(rol, 'Vista pública sin dirección', 'sin_columna',
    pg_temp.q($s$select address from public.public_properties limit 1$s$));
  perform pg_temp.rec(rol, 'Vista pública sin avalúo', 'sin_columna',
    pg_temp.q($s$select avaluo_fiscal_clp::text from public.public_properties limit 1$s$));
  perform pg_temp.rec(rol, 'Vista pública sin owner', 'sin_columna',
    pg_temp.q($s$select owner_id::text from public.public_properties limit 1$s$));
  perform pg_temp.rec(rol, 'Tabla properties (dirección) directa', 'denegado',
    pg_temp.q($s$select address from public.properties limit 1$s$));
  perform pg_temp.rec(rol, 'Lee guests', 'denegado', pg_temp.q($s$select count(*) from public.guests$s$));
  perform pg_temp.rec(rol, 'Lee reservations', 'denegado', pg_temp.q($s$select count(*) from public.reservations$s$));
  perform pg_temp.rec(rol, 'Lee payments', 'denegado', pg_temp.q($s$select count(*) from public.payments$s$));
  perform pg_temp.rec(rol, 'Lee owners', 'denegado', pg_temp.q($s$select count(*) from public.owners$s$));
  perform pg_temp.rec(rol, 'Lee calendar_occupancies', 'denegado', pg_temp.q($s$select count(*) from public.calendar_occupancies$s$));
  perform pg_temp.rec(rol, 'Lee vista staff_reservations', 'denegado', pg_temp.q($s$select count(*) from public.staff_reservations$s$));
  perform pg_temp.rec(rol, 'Lee vista owner_reservations', 'denegado', pg_temp.q($s$select count(*) from public.owner_reservations$s$));
  perform pg_temp.rec(rol, 'Inserta en properties', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.properties (owner_id, slug, name, city) values (%L, 't-hack', 'x', 'x') returning 1) select count(*) from x$s$, o_a)));
  perform pg_temp.rec(rol, 'Inserta en reservations', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.reservations (property_id, guest_id, owner_id, check_in, check_out, hold_expires_at) values (%L, %L, %L, '2031-01-01', '2031-01-03', now()) returning 1) select count(*) from x$s$, p_a, g, o_a)));
  perform pg_temp.rec(rol, 'Inserta en calendar_occupancies', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.calendar_occupancies (property_id, stay, kind) values (%L, '[2031-01-01,2031-01-03)', 'manual_block') returning 1) select count(*) from x$s$, p_a)));
  perform pg_temp.rec(rol, 'Modifica app_settings', 'denegado',
    pg_temp.q($s$with x as (update public.app_settings set value = 'hack' returning 1) select count(*) from x$s$));
  perform pg_temp.rec(rol, 'Disponibilidad: solo rangos unidos (días desde hoy)', '10-15,20-22',
    pg_temp.q(format($s$select string_agg((start_date - %L::date) || '-' || (end_date - %L::date), ',' order by start_date) from public.get_property_availability('t-a-pub', %L::date, %L::date + 60)$s$, hoy, hoy, hoy, hoy)));
  perform pg_temp.rec(rol, 'Disponibilidad de propiedad en borrador', '0',
    pg_temp.q(format($s$select count(*) from public.get_property_availability('t-a-draft', %L::date, %L::date + 60)$s$, hoy, hoy)));
  perform pg_temp.rec(rol, 'Ve fotos de propiedad publicada', '1',
    pg_temp.q(format($s$select count(*) from public.public_property_photos where property_id = %L$s$, p_a)));
  perform pg_temp.rec(rol, 'NO ve fotos de propiedad en borrador (vista)', '0',
    pg_temp.q(format($s$select count(*) from public.public_property_photos where property_id = %L$s$, p_a_draft)));
  perform pg_temp.rec(rol, 'Ve documento legal publicado (no el borrador)', '1',
    pg_temp.q($s$select count(*) from public.public_legal_documents where version like 'test-%'$s$));
  perform pg_temp.rec(rol, 'Sigue leyendo site_name (Sesión 1)', 'Reservas UP',
    pg_temp.q($s$select value from public.app_settings where key = 'site_name'$s$));
  perform pg_temp.rec(rol, 'NO ve settings privados', '0',
    pg_temp.q($s$select count(*) from public.app_settings where key = 'hold_payment_grace_minutes'$s$));
  perform pg_temp.rec(rol, 'Storage: sube foto', 'denegado',
    pg_temp.q(format($s$with x as (insert into storage.objects (bucket_id, name) values ('property-photos', '%s/hack.jpg') returning 1) select count(*) from x$s$, p_a)));
  perform pg_temp.rec(rol, 'Storage: modifica foto existente', '0',
    pg_temp.q($s$with x as (update storage.objects set name = name || '-x' where bucket_id = 'property-photos' returning 1) select count(*) from x$s$));
  perform pg_temp.rec(rol, 'Ejecuta create_manual_block', 'denegado',
    pg_temp.q(format($s$select public.create_manual_block(%L, '2031-02-01', '2031-02-03')::text$s$, p_a)));
  perform pg_temp.rec(rol, 'Ejecuta is_admin()', 'denegado', pg_temp.q($s$select public.is_admin()::text$s$));
  perform pg_temp.rec(rol, 'Cotiza con quote_stay (solo publicadas)', 'not_found',
    pg_temp.q($s$select public.quote_stay('t-a-draft', current_date + 30, current_date + 33, 2) ->> 'reason'$s$));
  perform pg_temp.rec(rol, 'Ejecuta public_price_from', 'null', pg_temp.q($s$select public.public_price_from('t-a-pub')::text$s$));
  perform pg_temp.rec(rol, 'Ejecuta internal_tax_breakdown', 'denegado',
    pg_temp.q(format($s$select public.internal_tax_breakdown(%L, current_date + 30, current_date + 33, 2)::text$s$, p_a)));
  perform pg_temp.rec(rol, 'Ejecuta pricing_core (interno)', 'denegado',
    pg_temp.q(format($s$select public.pricing_core(%L, current_date + 30, current_date + 33, 2)::text$s$, p_a)));
  perform pg_temp.as_postgres();
  perform pg_temp.rec(rol, 'Storage: el bucket es público (lectura por URL)', 'true',
    (select public::text from storage.buckets where id = 'property-photos'));
  perform pg_temp.rec(rol, 'Storage: la foto existente sigue intacta', '1',
    (select count(*)::text from storage.objects where bucket_id = 'property-photos' and name = p_a || '/test-existente.jpg'));

  -- ═══ AUTENTICADO SIN FILA EN app_users ═══════════════════════════════
  rol := 'autenticado sin perfil';
  perform pg_temp.as_role('authenticated', u_nada);
  perform pg_temp.rec(rol, 'Lee properties', '0', pg_temp.q($s$select count(*) from public.properties$s$));
  perform pg_temp.rec(rol, 'Lee owners', '0', pg_temp.q($s$select count(*) from public.owners$s$));
  perform pg_temp.rec(rol, 'Lee reservations', '0', pg_temp.q($s$select count(*) from public.reservations$s$));
  perform pg_temp.rec(rol, 'Lee guests', '0', pg_temp.q($s$select count(*) from public.guests$s$));
  perform pg_temp.rec(rol, 'Lee payments', '0', pg_temp.q($s$select count(*) from public.payments$s$));
  perform pg_temp.rec(rol, 'Lee app_users', '0', pg_temp.q($s$select count(*) from public.app_users$s$));
  perform pg_temp.rec(rol, 'Lee cleaning_tasks', '0', pg_temp.q($s$select count(*) from public.cleaning_tasks$s$));
  perform pg_temp.rec(rol, 'Lee calendar_occupancies', '0', pg_temp.q($s$select count(*) from public.calendar_occupancies$s$));
  perform pg_temp.rec(rol, 'Lee staff_reservations', '0', pg_temp.q($s$select count(*) from public.staff_reservations$s$));
  perform pg_temp.rec(rol, 'Lee staff_properties', '0', pg_temp.q($s$select count(*) from public.staff_properties$s$));
  perform pg_temp.rec(rol, 'Lee owner_reservations', '0', pg_temp.q($s$select count(*) from public.owner_reservations$s$));
  perform pg_temp.rec(rol, 'Inserta en properties', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.properties (owner_id, slug, name, city) values (%L, 't-hack', 'x', 'x') returning 1) select count(*) from x$s$, o_a)));
  perform pg_temp.rec(rol, 'Se asigna rol admin (insert en app_users)', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.app_users (id, role, full_name) values (%L, 'admin', 'hack') returning 1) select count(*) from x$s$, u_nada)));
  perform pg_temp.rec(rol, 'Ejecuta create_manual_block', 'denegado',
    pg_temp.q(format($s$select public.create_manual_block(%L, '2031-02-01', '2031-02-03')::text$s$, p_a)));
  perform pg_temp.rec(rol, 'Vistas públicas: igual que anon', '2',
    pg_temp.q(format($s$select count(*) from public.public_properties where slug in %s$s$, props)));
  perform pg_temp.as_postgres();

  -- ═══ ENCARGADO ═══════════════════════════════════════════════════════
  rol := 'encargado';
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec(rol, 'staff_reservations: confirmadas + conflicto, sin cancelada', '3',
    pg_temp.q(format($s$select count(*) from public.staff_reservations where property_id in (%L, %L)$s$, p_a, p_b)));
  perform pg_temp.rec(rol, 'staff_reservations incluye la reserva en conflicto', '1',
    pg_temp.q(format($s$select count(*) from public.staff_reservations where id = %L$s$, r_a_conf)));
  perform pg_temp.rec(rol, 'Ve nombre y teléfono del huésped', 'Huésped Prueba / +56911111111',
    pg_temp.q(format($s$select guest_name || ' / ' || guest_phone from public.staff_reservations where id = %L$s$, r_a)));
  perform pg_temp.rec(rol, 'staff_reservations sin email', 'sin_columna',
    pg_temp.q($s$select guest_email from public.staff_reservations limit 1$s$));
  perform pg_temp.rec(rol, 'staff_reservations sin montos', 'sin_columna',
    pg_temp.q($s$select total_clp::text from public.staff_reservations limit 1$s$));
  perform pg_temp.rec(rol, 'Lee payments', '0', pg_temp.q($s$select count(*) from public.payments$s$));
  perform pg_temp.rec(rol, 'Lee guests completos', '0', pg_temp.q($s$select count(*) from public.guests$s$));
  perform pg_temp.rec(rol, 'Lee reservations (tabla con montos)', '0', pg_temp.q($s$select count(*) from public.reservations$s$));
  perform pg_temp.rec(rol, 'Lee coupons', '0', pg_temp.q($s$select count(*) from public.coupons$s$));
  perform pg_temp.rec(rol, 'Lee owners (datos tributarios)', '0', pg_temp.q($s$select count(*) from public.owners$s$));
  perform pg_temp.rec(rol, 'staff_properties: ve la dirección', 'Calle Secreta 123, depto 45',
    pg_temp.q(format($s$select address from public.staff_properties where id = %L$s$, p_a)));
  perform pg_temp.rec(rol, 'staff_properties sin avalúo', 'sin_columna',
    pg_temp.q($s$select avaluo_fiscal_clp::text from public.staff_properties limit 1$s$));
  perform pg_temp.rec(rol, 'Actualiza estado y notas de un aseo', '1',
    pg_temp.q(format($s$with x as (update public.cleaning_tasks set status = 'hecha', notes = 'OK', completed_at = now() where property_id = %L returning 1) select count(*) from x$s$, p_a)));
  perform pg_temp.rec(rol, 'Cambia la propiedad de un aseo', 'denegado',
    pg_temp.q(format($s$with x as (update public.cleaning_tasks set property_id = %L returning 1) select count(*) from x$s$, p_b)));
  perform pg_temp.rec(rol, 'Modifica reservations', '0',
    pg_temp.q($s$with x as (update public.reservations set adults = 2 returning 1) select count(*) from x$s$));
  perform pg_temp.rec(rol, 'Códigos de acceso: vigente sí, de reserva cancelada no', '4321',
    pg_temp.q(format($s$select string_agg(code, ',') from public.staff_access_codes where property_id = %L$s$, p_a)));
  perform pg_temp.rec(rol, 'Ejecuta create_manual_block', 'denegado',
    pg_temp.q(format($s$select public.create_manual_block(%L, '2031-02-01', '2031-02-03')::text$s$, p_a)));
  perform pg_temp.rec(rol, 'Lee app_users: solo su perfil', '1', pg_temp.q($s$select count(*) from public.app_users$s$));
  perform pg_temp.rec(rol, 'Storage: sube foto', 'denegado',
    pg_temp.q(format($s$with x as (insert into storage.objects (bucket_id, name) values ('property-photos', '%s/enc.jpg') returning 1) select count(*) from x$s$, p_a)));
  perform pg_temp.as_postgres();

  -- ═══ PROPIETARIO (owner A) ═══════════════════════════════════════════
  rol := 'propietario';
  perform pg_temp.as_role('authenticated', u_prop);
  perform pg_temp.rec(rol, 'Ve sus propiedades (publicada + borrador)', '2',
    pg_temp.q(format($s$select count(*) from public.properties where owner_id = %L$s$, o_a)));
  perform pg_temp.rec(rol, 'NO ve la propiedad de otro owner', '0',
    pg_temp.q(format($s$select count(*) from public.properties where id = %L$s$, p_b)));
  perform pg_temp.rec(rol, 'owner_reservations: solo las suyas', '3',
    pg_temp.q($s$select count(*) from public.owner_reservations$s$));
  perform pg_temp.rec(rol, 'owner_reservations: NO las del otro owner', '0',
    pg_temp.q(format($s$select count(*) from public.owner_reservations where property_id = %L$s$, p_b)));
  perform pg_temp.rec(rol, 'owner_reservations sin datos del huésped', 'sin_columna',
    pg_temp.q($s$select guest_name from public.owner_reservations limit 1$s$));
  perform pg_temp.rec(rol, 'Resumen de montos (solo confirmadas)', '300000',
    pg_temp.q($s$select sum(total_clp)::text from public.owner_revenue_summary$s$));
  perform pg_temp.rec(rol, 'Lee guests', '0', pg_temp.q($s$select count(*) from public.guests$s$));
  perform pg_temp.rec(rol, 'Modifica su propiedad', '0',
    pg_temp.q($s$with x as (update public.properties set name = 'hack' returning 1) select count(*) from x$s$));
  perform pg_temp.rec(rol, 'Inserta una reserva', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.reservations (property_id, guest_id, owner_id, check_in, check_out, hold_expires_at) values (%L, %L, %L, '2031-01-01', '2031-01-03', now()) returning 1) select count(*) from x$s$, p_a, g, o_a)));
  perform pg_temp.as_postgres();

  -- ═══ ADMIN (René) ════════════════════════════════════════════════════
  rol := 'admin';
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec(rol, 'Lee todas las propiedades', '3',
    pg_temp.q(format($s$select count(*) from public.properties where slug in %s$s$, props)));
  perform pg_temp.rec(rol, 'Lee payments', '1',
    pg_temp.q(format($s$select count(*) from public.payments where reservation_id = %L$s$, r_a)));
  perform pg_temp.rec(rol, 'Lee guests con email', 'huesped@test.invalid',
    pg_temp.q($s$select email from public.guests where email = 'huesped@test.invalid'$s$));
  perform pg_temp.rec(rol, 'Actualiza una propiedad', '1',
    pg_temp.q(format($s$with x as (update public.properties set name = 'Renombrada' where id = %L returning 1) select count(*) from x$s$, p_a)));
  perform pg_temp.rec(rol, 'Actualiza un pago', '1',
    pg_temp.q(format($s$with x as (update public.payments set raw_payload = '{}' where reservation_id = %L returning 1) select count(*) from x$s$, r_a)));
  perform pg_temp.rec(rol, 'Crea un owner', '1',
    pg_temp.q($s$with x as (insert into public.owners (kind, legal_name, rut) values ('empresa', 'TEST C', 'TEST-C') returning 1) select count(*) from x$s$));
  perform pg_temp.rec(rol, 'Inserta ocupación reservation directa', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.calendar_occupancies (property_id, stay, kind, reservation_id) values (%L, '[2031-01-01,2031-01-03)', 'reservation', %L) returning 1) select count(*) from x$s$, p_a, r_a)));
  perform pg_temp.rec(rol, 'Modifica ocupación hold/reservation directa', 'denegado',
    pg_temp.q(format($s$with x as (update public.calendar_occupancies set status = 'cancelled' where reservation_id = %L returning 1) select count(*) from x$s$, r_a)));
  perform pg_temp.rec(rol, 'Borra una reserva', 'denegado',
    pg_temp.q(format($s$with x as (delete from public.reservations where id = %L returning 1) select count(*) from x$s$, r_b)));
  perform pg_temp.rec(rol, 'create_manual_block en fechas libres', 'ok',
    pg_temp.q(format($s$select case when public.create_manual_block(%L, %L::date + 40, %L::date + 42, 'test') is not null then 'ok' end$s$, p_a, hoy, hoy)));
  perform pg_temp.rec(rol, 'create_manual_block sobre una reserva', 'bloqueado',
    pg_temp.q(format($s$select public.create_manual_block(%L, %L::date + 11, %L::date + 12)::text$s$, p_a, hoy, hoy)));
  v_block := (select id from public.calendar_occupancies where note = 'test' and kind = 'manual_block');
  perform pg_temp.rec(rol, 'remove_manual_block libera las fechas', 'ok',
    pg_temp.q(format($s$select 'ok' from (select public.remove_manual_block(%L)) x$s$, v_block)));
  perform pg_temp.rec(rol, 'Tras quitarlo, se puede volver a bloquear', 'ok',
    pg_temp.q(format($s$select case when public.create_manual_block(%L, %L::date + 40, %L::date + 42) is not null then 'ok' end$s$, p_a, hoy, hoy)));
  perform pg_temp.rec(rol, 'Storage: sube foto', '1',
    pg_temp.q(format($s$with x as (insert into storage.objects (bucket_id, name) values ('property-photos', '%s/admin.jpg') returning 1) select count(*) from x$s$, p_a)));
  perform pg_temp.rec(rol, 'Último admin: se quita el rol a sí mismo', 'denegado',
    pg_temp.q(format($s$with x as (update public.app_users set role = 'encargado' where id = %L returning 1) select count(*) from x$s$, v_admin)));
  perform pg_temp.rec(rol, 'Último admin: se desactiva', 'denegado',
    pg_temp.q(format($s$with x as (update public.app_users set is_active = false where id = %L returning 1) select count(*) from x$s$, v_admin)));
  perform pg_temp.rec(rol, 'Último admin: se borra', 'denegado',
    pg_temp.q(format($s$with x as (delete from public.app_users where id = %L returning 1) select count(*) from x$s$, v_admin)));
  perform pg_temp.as_postgres();

  -- Con un segundo admin activo, quitar el rol al primero sí se permite.
  update public.app_users set role = 'admin' where id = u_enc;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec(rol, 'Con otro admin activo, puede dejar de ser admin', '1',
    pg_temp.q(format($s$with x as (update public.app_users set role = 'encargado' where id = %L returning 1) select count(*) from x$s$, v_admin)));
  perform pg_temp.as_postgres();
end;
$$;

select n as "#", rol, accion, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
