-- Panel de administración (Sesión 12): permisos, publicar con requisitos,
-- slug fijo, cambio de dueño solo por función, fotos de una publicada,
-- RUT válido, dueños en uso, amenidades, historial sin valores,
-- concurrencia optimista y Storage solo admin.
-- Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/admin_panel.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)

begin;

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

-- Ejecuta y devuelve el valor, 'denegado' (42501) o el código de error.
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

-- ¿La lista de faltantes contiene un texto?
create function pg_temp.falta(p_id uuid, p_texto text) returns text language sql as $$
  select (exists (select 1 from unnest(public.property_publish_check(p_id)) m where m like '%' || p_texto || '%'))::text;
$$;

create function pg_temp.photo(p_pid uuid, p_cover boolean default false, p_alt text default 'Foto de prueba') returns uuid language sql as $$
  insert into public.property_photos (property_id, storage_path, alt_text, is_cover, sort_order)
  values (p_pid, p_pid || '/' || gen_random_uuid() || '.webp', p_alt, p_cover,
          (select count(*) from public.property_photos where property_id = p_pid))
  returning id;
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc uuid := gen_random_uuid();
  o uuid; o2 uuid; g uuid; g0 uuid; g2 uuid; acc uuid; acc_gw uuid; p uuid; p2 uuid;
  f1 uuid; f2 uuid; f6 uuid;
  gst uuid; r uuid;
  v jsonb;
  ts timestamptz;
begin
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST Panel', '90000017-0', true) returning id into o;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('persona_natural', 'TEST Panel B', '90000018-9', false) returning id into o2;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (o, 'TEST con precio', 40000) returning id into g;
  -- Sesión 13: el precio base es > 0 por regla de la base; la validación de
  -- 90 noches con precio se prueba en rates_calendar.sql. Aquí: sin tarifa.
  g0 := null;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (o2, 'TEST B', 30000) returning id into g2;
  insert into public.payment_accounts (owner_id, label, bank_name, account_type, account_number, holder_name, holder_rut, holder_email)
    values (o, 'TEST cuenta', 'Banco TEST', 'Cuenta corriente', '00-111-22222-3', 'TEST', '90000017-0', 'p@test.invalid') returning id into acc;
  insert into public.payment_accounts (owner_id, label) values (o, 'TEST sin pasarela') returning id into acc_gw;
  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-panel@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST Encargado Panel');

  -- ═══ 1. Alta desde el panel: nace en borrador ═════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Admin crea una propiedad en borrador', '1',
    pg_temp.q(format($s$with x as (insert into public.properties (owner_id, rate_group_id, slug, name, city, amenities)
      values (%L, %L, 'test-panel', 'TEST Panel', 'Iquique', '{wifi, "Wi-Fi", "aire acondicionado", "Vista lejana"}') returning 1) select count(*)::text from x$s$, o, g0)));
  perform pg_temp.rec('Admin NO puede crearla ya publicada', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.properties (owner_id, slug, name, city, status) values (%L, 'test-panel-x', 'TEST X', 'Iquique', 'publicada') returning 1) select count(*)::text from x$s$, o)));
  perform pg_temp.as_postgres();
  select id into p from public.properties where slug = 'test-panel';
  perform pg_temp.rec('Amenidades normalizadas (wifi/Wi-Fi → Wifi, sin duplicados)', 'Wifi,Aire acondicionado,Vista lejana',
    (select array_to_string(amenities, ',') from public.properties where id = p));

  -- ═══ 2. Publicar: cada requisito faltante ═════════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Falta portada', 'true', pg_temp.falta(p, 'portada'));
  perform pg_temp.rec('Faltan fotos (al menos 5)', 'true', pg_temp.falta(p, 'al menos 5 fotos'));
  perform pg_temp.rec('Falta descripción', 'true', pg_temp.falta(p, 'descripción'));
  perform pg_temp.rec('Faltan horarios', 'true', pg_temp.falta(p, 'horas de llegada'));
  perform pg_temp.rec('Falta capacidad', 'true', pg_temp.falta(p, 'capacidad'));
  perform pg_temp.rec('Falta dirección privada', 'true', pg_temp.falta(p, 'dirección exacta'));
  perform pg_temp.rec('Faltan instrucciones de llegada', 'true', pg_temp.falta(p, 'instrucciones de llegada'));
  perform pg_temp.rec('Sin tarifa asignada', 'true', pg_temp.falta(p, 'Asigna una tarifa'));
  perform pg_temp.rec('Falta cuenta de cobro (pagos manuales)', 'true', pg_temp.falta(p, 'cuenta de cobro activa'));
  v := public.publish_property(p);
  perform pg_temp.rec('publish_property con faltantes → no publica y explica', 'false|borrador|true',
    (v ->> 'ok') || '|' || (select status::text from public.properties where id = p) || '|' || (jsonb_array_length(v -> 'missing') >= 9)::text);

  -- Se completa todo, requisito por requisito.
  perform pg_temp.as_postgres();
  perform pg_temp.photo(p, true); perform pg_temp.photo(p); perform pg_temp.photo(p); perform pg_temp.photo(p);
  perform pg_temp.rec('Foto sin texto alternativo → rechazada por la base', '23514',
    pg_temp.q(format($s$select pg_temp.photo(%L, false, '')::text$s$, p)));
  perform pg_temp.rec('Ruta de foto adivinable → rechazada', '23514',
    pg_temp.q(format($s$with x as (insert into public.property_photos (property_id, storage_path, alt_text) values (%L, %L || '/foto1.jpg', 'x foto') returning 1) select count(*)::text from x$s$, p, p)));
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('4 fotos: todavía faltan', 'true', pg_temp.falta(p, 'al menos 5 fotos'));
  perform pg_temp.as_postgres();
  perform pg_temp.photo(p);
  update public.properties set description = 'Departamento de prueba frente al mar, luminoso y equipado.', check_in_time = '15:00',
         check_out_time = '11:00', max_guests = 4, rate_group_id = g, payment_account_id = acc where id = p;
  insert into public.property_arrival_info (property_id, exact_address, access_instructions) values (p, 'Calle Test 123, depto 4', 'Caja de llaves con clave junto a la puerta.');
  update public.properties set allowed_payment_methods = '{bank_transfer,payment_link,gateway}', payment_account_id = acc_gw where id = p;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Con pasarela permitida y no configurada → falta', 'true', pg_temp.falta(p, 'pasarela'));
  perform pg_temp.rec('Cuenta sin datos de transferencia → falta', 'true', pg_temp.falta(p, 'datos de transferencia'));
  perform pg_temp.as_postgres();
  update public.properties set allowed_payment_methods = null, payment_account_id = acc where id = p;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Todo completo → nada falta', '0', (select cardinality(public.property_publish_check(p))::text));

  -- ═══ 3. Slug: editable en borrador, fijo desde la 1.ª publicación ═════
  perform pg_temp.rec('Slug editable mientras nunca se publicó', '1',
    pg_temp.q(format($s$with x as (update public.properties set slug = 'test-panel-2' where id = %L returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('Cambiar el estado con un UPDATE directo → denegado', 'denegado',
    pg_temp.q(format($s$with x as (update public.properties set status = 'publicada' where id = %L returning 1) select count(*)::text from x$s$, p)));
  v := public.publish_property(p);
  perform pg_temp.rec('Publicar → publicada con fecha de primera publicación', 'true|publicada|true',
    (v ->> 'ok') || '|' || (select status::text || '|' || (first_published_at is not null) from public.properties where id = p));
  perform pg_temp.rec('Slug fijo tras publicar', '23514',
    pg_temp.q(format($s$with x as (update public.properties set slug = 'test-panel-3' where id = %L returning 1) select count(*)::text from x$s$, p)));

  -- ═══ 4. Despublicar con reservas futuras ══════════════════════════════
  perform pg_temp.as_postgres();
  insert into public.guests (full_name, email) values ('TEST', 'panel@test.invalid') returning id into gst;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, total_clp)
    values (p, gst, o, 'confirmada', hoy + 30, hoy + 32, 80000) returning id into r;
  perform pg_temp.as_role('authenticated', v_admin);
  v := public.unpublish_property(p);
  perform pg_temp.rec('Despublicar con reservas futuras → pide confirmación, no cambia nada', 'false|true|1|publicada',
    (v ->> 'ok') || '|' || (v ->> 'needs_confirmation') || '|' || (v ->> 'future_reservations') || '|' ||
    (select status::text from public.properties where id = p));
  v := public.unpublish_property(p, true);
  perform pg_temp.rec('  confirmado → borrador; la reserva NO se cancela', 'true|borrador|confirmada',
    (v ->> 'ok') || '|' || (select status::text from public.properties where id = p) || '|' || (select status::text from public.reservations where id = r));
  perform pg_temp.rec('El slug sigue fijo aunque vuelva a borrador', '23514',
    pg_temp.q(format($s$with x as (update public.properties set slug = 'test-panel-4' where id = %L returning 1) select count(*)::text from x$s$, p)));
  perform public.publish_property(p);

  -- ═══ 5. Fotos de una propiedad publicada ══════════════════════════════
  select id into f1 from public.property_photos where property_id = p and is_cover;
  select id into f2 from public.property_photos where property_id = p and not is_cover order by sort_order limit 1;
  v := public.admin_delete_photo(f2);
  perform pg_temp.rec('Publicada con 5 fotos: borrar una → bloqueado con explicación', 'false|blocked|true',
    (v ->> 'ok') || '|' || (v ->> 'reason') || '|' || ((v ->> 'message') like '%al menos 5 fotos%')::text);
  perform pg_temp.as_postgres();
  f6 := pg_temp.photo(p);
  perform pg_temp.as_role('authenticated', v_admin);
  v := public.admin_delete_photo(f1);
  perform pg_temp.rec('Borrar la portada → bloqueado', 'false|true', (v ->> 'ok') || '|' || ((v ->> 'message') like '%portada%')::text);
  perform pg_temp.rec('Quitar la portada con un UPDATE → rechazado', '23514',
    pg_temp.q(format($s$with x as (update public.property_photos set is_cover = false where id = %L returning 1) select count(*)::text from x$s$, f1)));
  v := public.admin_set_cover(f6);
  perform pg_temp.rec('Cambiar la portada con admin_set_cover', 'true|true|1',
    (v ->> 'ok') || '|' || (select is_cover::text from public.property_photos where id = f6) || '|' ||
    (select count(*) from public.property_photos where property_id = p and is_cover));
  v := public.admin_delete_photo(f1);
  perform pg_temp.rec('Con 6 fotos y otra portada: se borra y devuelve la ruta del archivo', 'true|true',
    (v ->> 'ok') || '|' || ((v ->> 'storage_path') like p::text || '/%')::text);
  v := public.admin_reorder_photos(p, (select array_agg(id order by sort_order desc) from public.property_photos where property_id = p));
  perform pg_temp.rec('Reordenar fotos en una transacción', 'true|1',
    (v ->> 'ok') || '|' || (select sort_order from public.property_photos where id = f6));

  -- ═══ 6. Dueño: solo con change_property_owner ═════════════════════════
  perform pg_temp.rec('Cambiar el dueño con un UPDATE directo → denegado', 'denegado',
    pg_temp.q(format($s$with x as (update public.properties set owner_id = %L, rate_group_id = %L where id = %L returning 1) select count(*)::text from x$s$, o2, g2, p)));
  v := public.change_property_owner(p, o2, g2, 'Prueba del panel');
  perform pg_temp.rec('Vía change_property_owner → cambia y avisa reservas futuras', 'true|1',
    (v ->> 'ok') || '|' || (v ->> 'future_reservations_previous_owner'));

  -- ═══ 7. Dueños ════════════════════════════════════════════════════════
  perform pg_temp.rec('RUT inválido → rechazado por la base', '23514',
    pg_temp.q($s$with x as (insert into public.owners (kind, legal_name, rut) values ('empresa', 'TEST Malo', '76.086.428-4') returning 1) select count(*)::text from x$s$));
  perform pg_temp.rec('RUT válido con puntos y guion → aceptado', '1',
    pg_temp.q($s$with x as (insert into public.owners (kind, legal_name, rut) values ('empresa', 'TEST Bueno', '90.000.019-7') returning 1) select count(*)::text from x$s$));
  perform pg_temp.rec('Borrar un dueño con propiedades → rechazado', '23503',
    pg_temp.q(format($s$with x as (delete from public.owners where id = %L returning 1) select count(*)::text from x$s$, o2)));

  -- ═══ 8. Concurrencia optimista ════════════════════════════════════════
  select updated_at into ts from public.properties where id = p;
  perform pg_temp.rec('Guardar con el updated_at vigente → ok', '1',
    pg_temp.q(format($s$with x as (update public.properties set house_rules = 'Sin fiestas.', updated_at = %L where id = %L returning 1) select count(*)::text from x$s$, ts, p)));
  perform pg_temp.rec('Guardar con un updated_at antiguo (otro dispositivo guardó) → rechazado', '40001',
    pg_temp.q(format($s$with x as (update public.properties set house_rules = 'Otra cosa.', updated_at = %L where id = %L returning 1) select count(*)::text from x$s$, ts, p)));
  select updated_at into ts from public.owners where id = o;
  perform pg_temp.q(format($s$with x as (update public.owners set email = 'a@test.invalid', updated_at = %L where id = %L returning 1) select count(*)::text from x$s$, ts, o));
  perform pg_temp.rec('  también en dueños', '40001',
    pg_temp.q(format($s$with x as (update public.owners set email = 'b@test.invalid', updated_at = %L where id = %L returning 1) select count(*)::text from x$s$, ts, o)));
  select updated_at into ts from public.payment_accounts where id = acc;
  perform pg_temp.q(format($s$with x as (update public.payment_accounts set label = 'TEST cuenta 2', updated_at = %L where id = %L returning 1) select count(*)::text from x$s$, ts, acc));
  perform pg_temp.rec('  en cuentas de cobro', '40001',
    pg_temp.q(format($s$with x as (update public.payment_accounts set label = 'TEST cuenta 3', updated_at = %L where id = %L returning 1) select count(*)::text from x$s$, ts, acc)));
  select updated_at into ts from public.property_arrival_info where property_id = p;
  perform pg_temp.q(format($s$with x as (update public.property_arrival_info set parking = 'N° 12', updated_at = %L where property_id = %L returning 1) select count(*)::text from x$s$, ts, p));
  perform pg_temp.rec('  y en datos de llegada', '40001',
    pg_temp.q(format($s$with x as (update public.property_arrival_info set parking = 'N° 13', updated_at = %L where property_id = %L returning 1) select count(*)::text from x$s$, ts, p)));

  -- ═══ 9. Cuentas e historial sin valores ═══════════════════════════════
  perform pg_temp.q(format($s$with x as (update public.payment_accounts set account_number = '99-888-77777-6' where id = %L returning 1) select count(*)::text from x$s$, acc));
  perform pg_temp.rec('Historial: registra el campo cambiado, nunca el valor', 'true|false',
    (select ('account_number' = any(changed_fields))::text from public.admin_audit_log
      where table_name = 'payment_accounts' and record_id = acc::text order by id desc limit 1) || '|' ||
    (exists (select 1 from public.admin_audit_log l where l::text like '%77777%'))::text);
  perform pg_temp.rec('  con autor', 'true',
    (select (actor = v_admin)::text from public.admin_audit_log where table_name = 'payment_accounts' and record_id = acc::text order by id desc limit 1));
  perform pg_temp.rec('Lista de cuentas: número enmascarado', '••••7776',
    (select account_number_masked from public.admin_payment_accounts() where id = acc));
  perform pg_temp.rec('Nombre de secreto fuera de formato → rechazado', '23514',
    pg_temp.q(format($s$with x as (update public.payment_accounts set gateway_secret_name = 'SUPABASE_SERVICE_ROLE_KEY' where id = %L returning 1) select count(*)::text from x$s$, acc)));

  -- ═══ 10. Storage: solo el admin escribe y borra ═══════════════════════
  perform pg_temp.rec('Admin sube un archivo a property-photos', '1',
    pg_temp.q(format($s$with x as (insert into storage.objects (bucket_id, name) values ('property-photos', %L || '/' || gen_random_uuid() || '.webp') returning 1) select count(*)::text from x$s$, p)));

  -- ═══ 11. Encargado y anónimo: nada del panel ══════════════════════════
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: publish_property', 'denegado', pg_temp.q(format($s$select public.publish_property(%L)::text$s$, p)));
  perform pg_temp.rec('Encargado: property_publish_check', 'denegado', pg_temp.q(format($s$select public.property_publish_check(%L)::text$s$, p)));
  perform pg_temp.rec('Encargado: unpublish_property', 'denegado', pg_temp.q(format($s$select public.unpublish_property(%L, true)::text$s$, p)));
  perform pg_temp.rec('Encargado: admin_delete_photo', 'denegado', pg_temp.q(format($s$select public.admin_delete_photo(%L)::text$s$, f6)));
  perform pg_temp.rec('Encargado: admin_set_cover', 'denegado', pg_temp.q(format($s$select public.admin_set_cover(%L)::text$s$, f6)));
  perform pg_temp.rec('Encargado: admin_payment_accounts', 'denegado', pg_temp.q($s$select count(*)::text from public.admin_payment_accounts()$s$));
  perform pg_temp.rec('Encargado: historial → 0 filas', '0', pg_temp.q($s$select count(*)::text from public.admin_audit_log$s$));
  perform pg_temp.rec('Encargado: editar una propiedad → 0 filas', '0',
    pg_temp.q(format($s$with x as (update public.properties set name = 'Hackeada' where id = %L returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('Encargado: subir a property-photos → denegado', '42501',
    replace(pg_temp.q($s$with x as (insert into storage.objects (bucket_id, name) values ('property-photos', 'x/y.webp') returning 1) select count(*)::text from x$s$), 'denegado', '42501'));
  perform pg_temp.rec('Encargado: borrar de property-photos → denegado', 'denegado',
    pg_temp.q($s$with x as (delete from storage.objects where bucket_id = 'property-photos' returning 1) select count(*)::text from x$s$));
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: publish_property', 'denegado', pg_temp.q(format($s$select public.publish_property(%L)::text$s$, p)));
  perform pg_temp.rec('Anon: historial', 'denegado', pg_temp.q($s$select count(*)::text from public.admin_audit_log$s$));
  perform pg_temp.rec('Anon: subir a property-photos → denegado', '42501',
    replace(pg_temp.q($s$with x as (insert into storage.objects (bucket_id, name) values ('property-photos', 'x/y.webp') returning 1) select count(*)::text from x$s$), 'denegado', '42501'));
  perform pg_temp.rec('Anon: borrar de property-photos → denegado', 'denegado',
    pg_temp.q($s$with x as (delete from storage.objects where bucket_id = 'property-photos' returning 1) select count(*)::text from x$s$));
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Vistas públicas sin columnas nuevas del panel', '0',
    (select count(*)::text from information_schema.columns
      where table_schema = 'public' and table_name like 'public\_%' and column_name in ('first_published_at', 'payment_account_id', 'address')));
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
