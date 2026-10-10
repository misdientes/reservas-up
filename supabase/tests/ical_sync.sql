-- Sincronización iCal (Sesión 8): aplicación de importaciones, confirmación
-- doble antes de liberar, "fuente caída no libera", choques, exportación y
-- salud. Sin datos residuales: BEGIN … ROLLBACK.
--   npx supabase db query --linked -f supabase/tests/ical_sync.sql

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

-- Evento ya interpretado por la Edge Function.
create function pg_temp.ev(p_uid text, p_start date, p_end date) returns jsonb language sql as $$
  select jsonb_build_object('uid', p_uid, 'start', p_start, 'end', p_end);
$$;

-- Estado de la ocupación de un UID: "status/missing_count/stay" o "ninguna".
create function pg_temp.occ(p_cal uuid, p_uid text) returns text language sql as $$
  select coalesce(
    (select o.status || '/' || o.missing_count || '/' || o.stay::text
       from public.calendar_occupancies o
      where o.external_calendar_id = p_cal and o.external_uid = p_uid
      order by (o.status = 'active') desc, o.updated_at desc limit 1),
    'ninguna');
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d0 date;
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc uuid := gen_random_uuid();
  o uuid; pa uuid; pb uuid; g uuid;
  ca uuid; cx uuid; cy uuid;
  r_paid uuid; r_hold uuid;
  v jsonb;
  tok_x text;
begin
  d0 := hoy + 5;
  insert into public.owners (kind, legal_name, rut) values ('empresa', 'TEST', '90000005-7') returning id into o;
  insert into public.properties (owner_id, slug, name, city) values (o, 'test-ical-a', 'TEST A', 'Iquique') returning id into pa;
  insert into public.properties (owner_id, slug, name, city) values (o, 'test-ical-b', 'TEST B', 'Iquique') returning id into pb;
  insert into public.guests (full_name, email) values ('TEST', 'ical@test.invalid') returning id into g;
  insert into public.external_calendars (property_id, channel, import_url) values (pa, 'airbnb', 'https://www.airbnb.cl/x.ics') returning id into ca;
  insert into public.external_calendars (property_id, channel, import_url) values (pb, 'airbnb', 'https://www.airbnb.cl/y.ics') returning id into cx;
  insert into public.external_calendars (property_id, channel, import_url) values (pb, 'booking', 'https://admin.booking.com/z.ics') returning id into cy;
  select export_token into tok_x from public.external_calendars where id = cx;

  -- ═══ Importar, actualizar, fuente caída ═══════════════════════════════
  v := public.apply_ical_import(ca, true, jsonb_build_array(pg_temp.ev('u1', d0, d0 + 2)));
  perform pg_temp.rec('Evento nuevo → bloqueo iCal activo', 'active/0/' || daterange(d0, d0 + 2)::text, pg_temp.occ(ca, 'u1'));
  perform pg_temp.rec('  resumen: insertados', '1', v ->> 'inserted');
  v := public.apply_ical_import(ca, true, jsonb_build_array(pg_temp.ev('u1', d0, d0 + 2)));
  perform pg_temp.rec('Mismo evento otra vez → sin cambios', '1', v ->> 'unchanged');
  v := public.apply_ical_import(ca, true, jsonb_build_array(pg_temp.ev('u1', d0 + 1, d0 + 3)));
  perform pg_temp.rec('Cambio de fechas del mismo UID → se actualiza', 'active/0/' || daterange(d0 + 1, d0 + 3)::text, pg_temp.occ(ca, 'u1'));

  update public.external_calendars set last_success_at = now() - interval '5 minutes' where id = ca;
  v := public.apply_ical_import(ca, false, null, 'HTTP 503');
  perform pg_temp.rec('FUENTE CAÍDA → el bloqueo sigue intacto', 'active/0/' || daterange(d0 + 1, d0 + 3)::text, pg_temp.occ(ca, 'u1'));
  perform pg_temp.rec('  estado de error guardado', 'error|HTTP 503',
    (select last_sync_status || '|' || last_sync_error from public.external_calendars where id = ca));
  perform pg_temp.rec('  last_success_at no avanza', 'true',
    (select last_success_at < now() - interval '4 minutes' from public.external_calendars where id = ca)::text);
  v := public.apply_ical_import(ca, false, '[]'::jsonb, 'Archivo no es un VCALENDAR válido');
  perform pg_temp.rec('ARCHIVO CORRUPTO (aunque venga sin eventos) → no libera', 'active/0/' || daterange(d0 + 1, d0 + 3)::text, pg_temp.occ(ca, 'u1'));

  -- ═══ Confirmación doble antes de liberar ══════════════════════════════
  v := public.apply_ical_import(ca, true, '[]'::jsonb);
  perform pg_temp.rec('Calendario vacío válido 1 vez → nada se libera (marcado)', 'active/1/' || daterange(d0 + 1, d0 + 3)::text, pg_temp.occ(ca, 'u1'));
  v := public.apply_ical_import(ca, true, jsonb_build_array(pg_temp.ev('u1', d0 + 1, d0 + 3)));
  perform pg_temp.rec('Desaparece y reaparece → activo, marca limpia', 'active/0/' || daterange(d0 + 1, d0 + 3)::text, pg_temp.occ(ca, 'u1'));
  v := public.apply_ical_import(ca, true, '[]'::jsonb);
  perform pg_temp.rec('Desaparece 1 vez → sigue activo', 'active', split_part(pg_temp.occ(ca, 'u1'), '/', 1));
  v := public.apply_ical_import(ca, false, null, 'timeout');
  perform pg_temp.rec('  una falla entre medio no cuenta ni libera', 'active/1', split_part(pg_temp.occ(ca, 'u1'), '/', 1) || '/' || split_part(pg_temp.occ(ca, 'u1'), '/', 2));
  v := public.apply_ical_import(ca, true, '[]'::jsonb);
  perform pg_temp.rec('Desaparece 2 veces seguidas (exitosas) → released', 'released', split_part(pg_temp.occ(ca, 'u1'), '/', 1));
  perform pg_temp.rec('  y la noche queda libre', '0',
    (select count(*)::text from public.calendar_occupancies where property_id = pa and status = 'active'));

  -- ═══ Choques ══════════════════════════════════════════════════════════
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out)
    values (pb, g, o, 'confirmada', d0 + 10, d0 + 13) returning id into r_paid;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at)
    values (pb, g, o, 'hold', d0 + 20, d0 + 22, now() + interval '20 minutes') returning id into r_hold;
  insert into public.calendar_occupancies (property_id, stay, kind) values (pb, daterange(d0 + 30, d0 + 31), 'manual_block');

  v := public.apply_ical_import(cx, true, jsonb_build_array(
    pg_temp.ev('x-pagada', d0 + 11, d0 + 12),
    pg_temp.ev('x-hold', d0 + 21, d0 + 22),
    pg_temp.ev('x-manual', d0 + 30, d0 + 31),
    pg_temp.ev('x-libre', d0 + 40, d0 + 42)));
  perform pg_temp.rec('Choque con reserva pagada → reserva en conflicto', 'conflicto', (select status::text from public.reservations where id = r_paid));
  perform pg_temp.rec('  registro tipo reserva', 'reserva',
    (select string_agg(conflict_type::text, ',') from public.calendar_conflicts where external_uid = 'x-pagada' and resolved_at is null));
  perform pg_temp.rec('Choque con hold → registrado, el hold no cambia', 'hold|hold',
    (select string_agg(conflict_type::text, ',') from public.calendar_conflicts where external_uid = 'x-hold' and resolved_at is null)
    || '|' || (select status::text from public.reservations where id = r_hold));
  perform pg_temp.rec('Choque con bloqueo manual → cubierto (sin alarma)', 'cubierto',
    (select string_agg(conflict_type::text, ',') from public.calendar_conflicts where external_uid = 'x-manual' and resolved_at is null));
  perform pg_temp.rec('Evento sin choque → importado', 'active', split_part(pg_temp.occ(cx, 'x-libre'), '/', 1));

  v := public.apply_ical_import(cx, true, jsonb_build_array(
    pg_temp.ev('x-pagada', d0 + 11, d0 + 12), pg_temp.ev('x-hold', d0 + 21, d0 + 22),
    pg_temp.ev('x-manual', d0 + 30, d0 + 31), pg_temp.ev('x-libre', d0 + 40, d0 + 42)));
  perform pg_temp.rec('Importación repetida → un solo registro abierto por UID', '1|1|1',
    (select count(*) from public.calendar_conflicts where external_uid = 'x-pagada' and resolved_at is null) || '|' ||
    (select count(*) from public.calendar_conflicts where external_uid = 'x-hold' and resolved_at is null) || '|' ||
    (select count(*) from public.calendar_conflicts where external_uid = 'x-manual' and resolved_at is null));

  -- El hold se libera: en la siguiente corrida el evento sí se importa.
  update public.reservations set status = 'cancelada', cancellation_reason = 'hold_expirado' where id = r_hold;
  v := public.apply_ical_import(cx, true, jsonb_build_array(
    pg_temp.ev('x-pagada', d0 + 11, d0 + 12), pg_temp.ev('x-hold', d0 + 21, d0 + 22),
    pg_temp.ev('x-manual', d0 + 30, d0 + 31), pg_temp.ev('x-libre', d0 + 40, d0 + 42)));
  perform pg_temp.rec('Hold liberado → el evento se importa en la siguiente corrida', 'active', split_part(pg_temp.occ(cx, 'x-hold'), '/', 1));
  perform pg_temp.rec('  y su choque queda cerrado (importado)', 'importado',
    (select string_agg(resolution, ',') from public.calendar_conflicts where external_uid = 'x-hold'));

  -- Airbnb y Booking bloqueando lo mismo: el segundo queda "cubierto".
  v := public.apply_ical_import(cy, true, jsonb_build_array(pg_temp.ev('y-mismo', d0 + 40, d0 + 42), pg_temp.ev('y-otro', d0 + 50, d0 + 52)));
  perform pg_temp.rec('Airbnb + Booking mismas noches → Booking cubierto', 'cubierto',
    (select string_agg(conflict_type::text, ',') from public.calendar_conflicts where external_uid = 'y-mismo' and resolved_at is null));
  perform pg_temp.rec('  ninguna reserva cambió de estado por eso', 'conflicto',
    (select string_agg(distinct status::text, ',') from public.reservations where property_id = pb and status <> 'cancelada'));

  -- ═══ Exportación ══════════════════════════════════════════════════════
  perform pg_temp.rec('Exportación a Airbnb: reservas + manual + Booking (sin holds ni eventos propios)',
    'No disponible:' || (d0 + 30) || ',No disponible:' || (d0 + 50) || ',Reservado:' || (d0 + 10),
    (select string_agg(summary || ':' || start_date, ',' order by summary, start_date) from public.ical_export_events(tok_x)));
  perform pg_temp.rec('  ningún evento del propio calendario Airbnb', '0',
    (select count(*)::text from public.ical_export_events(tok_x) e
      join public.calendar_occupancies o on o.id::text || '@reservas-up' = e.uid
     where o.external_calendar_id = cx));
  perform pg_temp.rec('  UID estable (id de la ocupación)', 'true',
    ((select string_agg(uid, ',' order by uid) from public.ical_export_events(tok_x))
     = (select string_agg(uid, ',' order by uid) from public.ical_export_events(tok_x)))::text);
  perform pg_temp.rec('Token inexistente → error', 'P0002',
    (select pg_temp.q($s$select count(*)::text from public.ical_export_events('no-existe')$s$)));

  -- ═══ Salud ════════════════════════════════════════════════════════════
  update public.external_calendars set last_success_at = now() - interval '61 minutes', last_sync_status = 'ok' where id = cy;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('sync_health: 61 min sin éxito → atrasado', 'atrasado',
    (select status from public.sync_health where calendar_id = cy));
  perform pg_temp.rec('sync_health: choques abiertos por tipo (reserva/hold/cubierto) de Airbnb', '1/0/1',
    (select open_conflicts_reserva || '/' || open_conflicts_hold || '/' || covered_events from public.sync_health where calendar_id = cx));
  perform pg_temp.as_postgres();
  v := public.apply_ical_import(cy, true, jsonb_build_array(pg_temp.ev('y-mismo', d0 + 40, d0 + 42), pg_temp.ev('y-otro', d0 + 50, d0 + 52)));
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('sync_health: tras un éxito → ok', 'ok', (select status from public.sync_health where calendar_id = cy));
  perform pg_temp.as_postgres();

  -- ═══ Permisos ═════════════════════════════════════════════════════════
  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-ical@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST');
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: sync_health', '0', pg_temp.q($s$select count(*)::text from public.sync_health$s$));
  perform pg_temp.rec('Encargado: apply_ical_import', 'denegado',
    pg_temp.q(format($s$select public.apply_ical_import(%L, true, '[]')::text$s$, ca)));
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: apply_ical_import', 'denegado', pg_temp.q(format($s$select public.apply_ical_import(%L, true, '[]')::text$s$, ca)));
  perform pg_temp.rec('Anon: ical_calendars_to_sync (URLs secretas)', 'denegado', pg_temp.q($s$select count(*)::text from public.ical_calendars_to_sync()$s$));
  perform pg_temp.rec('Anon: ical_export_events', 'denegado', pg_temp.q(format($s$select count(*)::text from public.ical_export_events(%L)$s$, tok_x)));
  perform pg_temp.rec('Anon: sync_health', 'denegado', pg_temp.q($s$select count(*)::text from public.sync_health$s$));
  perform pg_temp.as_postgres();
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
