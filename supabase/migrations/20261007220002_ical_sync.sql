-- Sesión 8 (2/2): sincronización iCal (importación, exportación y salud).
-- Reglas (CLAUDE.md §4.3, §4.4, §4.6 y docs/ical.md):
--  * Una descarga fallida o un archivo inválido NO modifica nada.
--  * Liberar exige confirmación doble: un UID que falta en una importación
--    exitosa solo se marca; se libera si también falta en la SIGUIENTE.
--  * Choques: con reserva pagada → 'reserva' (la reserva pasa a conflicto);
--    con hold → 'hold' (se reintenta en cada corrida); con bloqueo manual u
--    otro iCal → 'cubierto' (no es conflicto, sin alarma).

create extension if not exists pg_net with schema extensions;

-- ─── Esquema ─────────────────────────────────────────────────────────────
create type public.conflict_type as enum ('reserva', 'hold', 'cubierto', 'otro');

alter table public.calendar_conflicts
  add column conflict_type public.conflict_type not null default 'otro';

-- Confirmación doble antes de liberar un bloqueo iCal.
alter table public.calendar_occupancies
  add column missing_since timestamptz,
  add column missing_count integer not null default 0 check (missing_count >= 0);

alter table public.external_calendars
  add column last_attempt_at timestamptz,
  add column last_success_at timestamptz,
  add column last_sync_summary jsonb;

-- Hosts permitidos para importar (editable sin código; privado).
-- "airbnb.*" acepta cualquier dominio de Airbnb (airbnb.cl, airbnb.com…);
-- los demás aceptan el dominio y sus subdominios.
insert into public.app_settings (key, value, is_public)
values ('ical_allowed_hosts', 'airbnb.*,booking.com,google.com', false)
on conflict (key) do nothing;

-- ─── Registro de choques (reemplaza la versión de la Sesión 2) ───────────
-- Usa la definición única (active_occupancies) y clasifica el choque.
-- Idempotente: un registro abierto por (calendario, UID, ocupación).
create or replace function public.register_calendar_conflict(
  p_external_calendar_id uuid,
  p_external_uid text,
  p_stay daterange,
  p_summary text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_count integer;
begin
  select property_id into strict v_property_id
    from public.external_calendars
   where id = p_external_calendar_id;

  with conflicting as (
    select a.id,
           a.reservation_id,
           case
             when a.kind = 'reservation' then 'reserva'::public.conflict_type
             when a.kind = 'hold' then 'hold'::public.conflict_type
             when a.kind in ('manual_block', 'ical_block') then 'cubierto'::public.conflict_type
             else 'otro'::public.conflict_type
           end as conflict_type
      from public.active_occupancies(v_property_id) a
     where a.stay && p_stay
       and not (a.external_calendar_id is not distinct from p_external_calendar_id
                and a.external_uid is not distinct from p_external_uid)
  ),
  inserted as (
    insert into public.calendar_conflicts (
      property_id, external_calendar_id, external_uid, rejected_stay, summary,
      conflicting_occupancy_id, reservation_id, conflict_type
    )
    select v_property_id, p_external_calendar_id, p_external_uid, p_stay, p_summary, c.id, c.reservation_id, c.conflict_type
      from conflicting c
    on conflict (external_calendar_id, external_uid, conflicting_occupancy_id)
      where resolved_at is null
      do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  -- Solo una reserva confirmada (pagada) pasa a 'conflicto' (alarma).
  update public.reservations r
     set status = 'conflicto'
   where r.status = 'confirmada'
     and r.id in (
       select a.reservation_id
         from public.active_occupancies(v_property_id) a
        where a.stay && p_stay
          and a.kind = 'reservation'
     );

  return v_count;
end;
$$;

revoke execute on function public.register_calendar_conflict(uuid, text, daterange, text) from public, anon, authenticated;

-- ─── Aplicar una importación ─────────────────────────────────────────────
-- La llama la Edge Function ical-import después de descargar e interpretar
-- el archivo. Todo en una transacción. p_events: [{uid, start, end}] ya
-- recortados a la ventana y sin UIDs duplicados.
create function public.apply_ical_import(
  p_calendar_id uuid,
  p_ok boolean,
  p_events jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cal public.external_calendars%rowtype;
  v_ev record;
  v_occ record;
  v_stay daterange;
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_marked int := 0;
  v_released int := 0;
  v_conflicts int := 0;
  v_summary jsonb;
begin
  select * into v_cal from public.external_calendars where id = p_calendar_id for update;
  if not found then
    raise exception 'Calendario externo inexistente' using errcode = 'P0002';
  end if;

  -- REGLA DE SEGURIDAD: si la descarga o el archivo fallaron, no se toca
  -- ninguna ocupación. Solo se registra el error.
  if not coalesce(p_ok, false) then
    update public.external_calendars
       set last_attempt_at = now(),
           last_sync_status = 'error',
           last_sync_error = left(coalesce(p_error, 'Error desconocido'), 500)
     where id = p_calendar_id;
    return jsonb_build_object('ok', false);
  end if;

  for v_ev in
    select e ->> 'uid' as uid, (e ->> 'start')::date as start_date, (e ->> 'end')::date as end_date
      from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
  loop
    v_stay := daterange(v_ev.start_date, v_ev.end_date, '[)');

    select o.id, o.stay into v_occ
      from public.calendar_occupancies o
     where o.external_calendar_id = p_calendar_id
       and o.external_uid = v_ev.uid
       and o.status = 'active';

    if found then
      -- Reapareció o sigue: se limpia la marca de "faltante".
      update public.calendar_occupancies set missing_since = null, missing_count = 0 where id = v_occ.id;
      if v_occ.stay = v_stay then
        v_unchanged := v_unchanged + 1;
      else
        begin
          update public.calendar_occupancies set stay = v_stay where id = v_occ.id;
          v_updated := v_updated + 1;
        exception when exclusion_violation then
          -- Las fechas nuevas chocan: se conserva el bloqueo anterior y se registra.
          v_conflicts := v_conflicts + public.register_calendar_conflict(p_calendar_id, v_ev.uid, v_stay, null);
        end;
      end if;
    else
      begin
        insert into public.calendar_occupancies (property_id, stay, kind, external_calendar_id, external_uid)
        values (v_cal.property_id, v_stay, 'ical_block', p_calendar_id, v_ev.uid);
        v_inserted := v_inserted + 1;
        -- Si antes chocaba (por ejemplo con un hold ya liberado), se cierra el choque.
        update public.calendar_conflicts
           set resolved_at = now(), resolution = 'importado'
         where external_calendar_id = p_calendar_id and external_uid = v_ev.uid and resolved_at is null;
      exception when exclusion_violation then
        v_conflicts := v_conflicts + public.register_calendar_conflict(p_calendar_id, v_ev.uid, v_stay, null);
      end;
    end if;
  end loop;

  -- UIDs de este calendario que no vinieron: confirmación doble.
  for v_occ in
    select o.id, o.missing_count, o.external_uid
      from public.calendar_occupancies o
     where o.external_calendar_id = p_calendar_id
       and o.status = 'active'
       and o.external_uid not in (
         select e ->> 'uid' from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
       )
  loop
    if v_occ.missing_count >= 1 then
      update public.calendar_occupancies
         set status = 'released', released_at = now()
       where id = v_occ.id;
      update public.calendar_conflicts
         set resolved_at = now(), resolution = 'evento eliminado'
       where external_calendar_id = p_calendar_id and external_uid = v_occ.external_uid and resolved_at is null;
      v_released := v_released + 1;
    else
      update public.calendar_occupancies
         set missing_since = now(), missing_count = 1
       where id = v_occ.id;
      v_marked := v_marked + 1;
    end if;
  end loop;

  -- Choques abiertos de eventos que ya no vienen (nunca llegaron a importarse).
  update public.calendar_conflicts c
     set resolved_at = now(), resolution = 'evento eliminado'
   where c.external_calendar_id = p_calendar_id
     and c.resolved_at is null
     and c.external_uid not in (select e ->> 'uid' from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e)
     and not exists (
       select 1 from public.calendar_occupancies o
        where o.external_calendar_id = p_calendar_id and o.external_uid = c.external_uid and o.status = 'active'
     );

  v_summary := jsonb_build_object(
    'ok', true, 'events', jsonb_array_length(coalesce(p_events, '[]'::jsonb)),
    'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
    'marked_missing', v_marked, 'released', v_released, 'conflicts', v_conflicts
  );

  update public.external_calendars
     set last_attempt_at = now(),
         last_success_at = now(),
         last_synced_at = now(),
         last_sync_status = 'ok',
         last_sync_error = null,
         last_sync_summary = v_summary
   where id = p_calendar_id;

  return v_summary;
end;
$$;

-- Calendarios a sincronizar (todos, o los de una propiedad: sync_property).
create function public.ical_calendars_to_sync(p_property_id uuid default null)
returns table (id uuid, property_id uuid, channel public.calendar_channel, import_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.property_id, c.channel, c.import_url
    from public.external_calendars c
   where c.is_active
     and c.import_url is not null
     and (p_property_id is null or c.property_id = p_property_id)
   order by c.id;
$$;

create function public.ical_allowed_hosts()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'ical_allowed_hosts'), 'airbnb.*,booking.com,google.com');
$$;

-- ─── Exportación ─────────────────────────────────────────────────────────
-- Eventos del calendario que entregamos a un canal: reservas confirmadas,
-- completadas o en conflicto; bloqueos manuales; iCal de OTROS calendarios.
-- Nunca holds, nunca los eventos del propio calendario (evita bucles).
-- Sin datos personales: solo "Reservado" o "No disponible".
create function public.ical_export_events(p_token text)
returns table (uid text, start_date date, end_date date, summary text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cal public.external_calendars%rowtype;
begin
  select * into v_cal from public.external_calendars where export_token = p_token;
  if not found then
    raise exception 'Calendario no encontrado' using errcode = 'P0002';
  end if;

  return query
  select a.id::text || '@reservas-up',
         lower(a.stay),
         upper(a.stay),
         case when a.kind = 'reservation' then 'Reservado' else 'No disponible' end
    from public.active_occupancies(v_cal.property_id) a
   where upper(a.stay) >= (now() at time zone 'America/Santiago')::date
     and (
       (a.kind = 'reservation' and a.reservation_status in ('confirmada', 'completada', 'conflicto'))
       or a.kind = 'manual_block'
       or (a.kind = 'ical_block' and a.external_calendar_id is distinct from v_cal.id)
     )
   order by lower(a.stay);
end;
$$;

-- ─── Salud de la sincronización (solo admin) ─────────────────────────────
-- atrasado = más de 60 minutos sin un éxito (el aviso por email: Sesión 11).
create view public.sync_health
with (security_invoker = false, security_barrier = true)
as
select c.id as calendar_id,
       c.property_id,
       p.name as property_name,
       c.channel,
       c.name as calendar_name,
       c.is_active,
       c.last_attempt_at,
       c.last_success_at,
       c.last_sync_status,
       c.last_sync_error,
       c.last_sync_summary,
       floor(extract(epoch from now() - c.last_success_at) / 60)::integer as minutes_since_success,
       (select count(*) from public.calendar_conflicts k
         where k.external_calendar_id = c.id and k.resolved_at is null and k.conflict_type = 'reserva')::integer as open_conflicts_reserva,
       (select count(*) from public.calendar_conflicts k
         where k.external_calendar_id = c.id and k.resolved_at is null and k.conflict_type = 'hold')::integer as open_conflicts_hold,
       (select count(*) from public.calendar_conflicts k
         where k.external_calendar_id = c.id and k.resolved_at is null and k.conflict_type = 'cubierto')::integer as covered_events,
       case
         when not c.is_active then 'inactivo'
         when coalesce(c.last_success_at, c.created_at) < now() - interval '60 minutes' then 'atrasado'
         when c.last_sync_status = 'error' then 'error'
         when c.last_success_at is null then 'pendiente'
         else 'ok'
       end as status
  from public.external_calendars c
  join public.properties p on p.id = c.property_id
 where public.is_admin();

revoke all on public.sync_health from public, anon, authenticated;
grant select on public.sync_health to authenticated;

-- ─── Permisos de las funciones ───────────────────────────────────────────
revoke execute on function public.apply_ical_import(uuid, boolean, jsonb, text) from public, anon, authenticated;
revoke execute on function public.ical_calendars_to_sync(uuid) from public, anon, authenticated;
revoke execute on function public.ical_allowed_hosts() from public, anon, authenticated;
revoke execute on function public.ical_export_events(text) from public, anon, authenticated;
grant execute on function public.apply_ical_import(uuid, boolean, jsonb, text) to service_role;
grant execute on function public.ical_calendars_to_sync(uuid) to service_role;
grant execute on function public.ical_allowed_hosts() to service_role;
grant execute on function public.ical_export_events(text) to service_role;

-- ─── Jobs ────────────────────────────────────────────────────────────────
-- Importación cada 10 minutos: pg_net llama a la Edge Function con el
-- secreto compartido guardado en Vault (nunca en git). Sin secreto, la
-- función responde 401 y no se modifica nada.
select cron.schedule(
  'ical-import',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://ygsckeyfewlcitrwbywf.supabase.co/functions/v1/ical-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ical_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- Limpieza diaria del historial de pg_cron (más de 7 días). Las respuestas
-- de pg_net (net._http_response) se limpian solas (TTL de la extensión).
select cron.schedule(
  'cron-history-cleanup',
  '17 4 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '7 days' $job$
);
