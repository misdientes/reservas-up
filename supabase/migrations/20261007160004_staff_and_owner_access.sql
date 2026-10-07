-- Sesión 3 (4/6): permisos de admin, encargado y propietario.
-- Los tres comparten el rol de base de datos "authenticated": los GRANT de
-- tabla son comunes y RLS decide qué filas ve cada uno. Lo que el encargado
-- y el propietario no deben ver (montos, email, datos tributarios) no se
-- les abre por política: lo leen a través de vistas con columnas fijas.
-- Un usuario autenticado sin fila activa en app_users no coincide con
-- ninguna política: no ve nada privado.

-- ─── GRANT de tabla para authenticated ───────────────────────────────────
do $$
declare
  t text;
begin
  -- Lectura y escritura completas (RLS limita a admin).
  foreach t in array array[
    'owners', 'managers', 'rate_groups', 'rate_seasons', 'properties', 'property_photos',
    'guests', 'legal_documents', 'coupons', 'message_templates', 'app_users',
    'external_calendars', 'cleaning_tasks', 'access_codes', 'app_settings'
  ] loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;

  -- Historial que no se borra: se cancela o anula.
  foreach t in array array['reservations', 'payments', 'tax_documents'] loop
    execute format('grant select, insert, update on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- Ocupaciones: solo lectura. Las de reservas las mantiene el trigger de
-- reservations; los bloqueos manuales, create/remove_manual_block; los iCal,
-- el import del servidor (Sesión 8).
grant select on table public.calendar_occupancies to authenticated;
-- Conflictos: se leen y se marcan como resueltos; los crea register_calendar_conflict.
grant select, update on table public.calendar_conflicts to authenticated;

-- ─── Admin: todo, en todas las tablas ────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'owners', 'managers', 'rate_groups', 'rate_seasons', 'properties', 'property_photos',
    'guests', 'legal_documents', 'coupons', 'message_templates', 'app_users',
    'external_calendars', 'reservations', 'calendar_occupancies', 'calendar_conflicts',
    'payments', 'tax_documents', 'cleaning_tasks', 'access_codes', 'app_settings'
  ] loop
    execute format(
      'create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end;
$$;

-- Cada usuario lee su propio perfil (el frontend necesita saber su rol).
create policy app_users_read_own on public.app_users
  for select to authenticated
  using (id = auth.uid());

-- ─── Encargado ───────────────────────────────────────────────────────────
-- Aseos: lee y actualiza (solo estado, notas y fecha de término; ver trigger).
create policy cleaning_tasks_staff_select on public.cleaning_tasks
  for select to authenticated
  using (public.is_staff());

create policy cleaning_tasks_staff_update on public.cleaning_tasks
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create function public.cleaning_tasks_restrict_staff_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() = 'encargado'
     and (new.property_id, new.reservation_id, new.scheduled_for, new.assigned_to, new.created_at)
         is distinct from
         (old.property_id, old.reservation_id, old.scheduled_for, old.assigned_to, old.created_at) then
    raise exception 'El encargado solo puede cambiar estado, notas y fecha de término del aseo'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.cleaning_tasks_restrict_staff_update() from public, anon, authenticated;

create trigger cleaning_tasks_restrict_staff_update
  before update on public.cleaning_tasks
  for each row execute function public.cleaning_tasks_restrict_staff_update();

-- Propiedades para operar: con dirección, sin avalúo, owner ni modelo tributario.
create view public.staff_properties
with (security_invoker = false, security_barrier = true)
as
select p.id,
       p.slug,
       p.name,
       p.city,
       p.neighborhood,
       p.address,
       p.max_guests,
       p.bedrooms,
       p.beds,
       p.bathrooms,
       p.check_in_time,
       p.check_out_time,
       p.house_rules,
       p.status
  from public.properties p
 where public.is_staff();

-- Reservas que ocupan noches (confirmadas, completadas o en conflicto),
-- futuras y de los últimos 7 días. Solo lo operativo (Ley 21.719): nombre y
-- teléfono del huésped, fechas y cantidad de personas. Sin email, documento,
-- montos, pagos ni cupones.
create view public.staff_reservations
with (security_invoker = false, security_barrier = true)
as
select r.id,
       r.code,
       r.property_id,
       p.name as property_name,
       g.full_name as guest_name,
       g.phone as guest_phone,
       r.check_in,
       r.check_out,
       r.nights,
       r.adults,
       r.children,
       r.status
  from public.reservations r
  join public.properties p on p.id = r.property_id
  join public.guests g on g.id = r.guest_id
 where public.is_staff()
   and r.status in ('confirmada', 'completada', 'conflicto')
   and r.check_out >= (now() at time zone 'America/Santiago')::date - 7;

-- Códigos de acceso vigentes o próximos de reservas que ocupan noches.
create view public.staff_access_codes
with (security_invoker = false, security_barrier = true)
as
select a.id,
       a.property_id,
       a.reservation_id,
       r.code as reservation_code,
       a.code,
       a.valid_from,
       a.valid_to,
       a.status
  from public.access_codes a
  join public.reservations r on r.id = a.reservation_id
 where public.is_staff()
   and r.status in ('confirmada', 'conflicto')
   and a.status <> 'revocado'
   and a.valid_to >= now();

-- ─── Propietario (marketplace futuro) ────────────────────────────────────
create policy properties_owner_select on public.properties
  for select to authenticated
  using (owner_id = public.current_owner_id());

-- Reservas de sus propiedades, SIN datos del huésped, con montos y comisión.
create view public.owner_reservations
with (security_invoker = false, security_barrier = true)
as
select r.id,
       r.code,
       r.property_id,
       p.name as property_name,
       r.channel,
       r.status,
       r.check_in,
       r.check_out,
       r.nights,
       r.adults,
       r.children,
       r.net_total_clp,
       r.vat_clp,
       r.total_clp,
       r.commission_rate,
       round(r.net_total_clp * r.commission_rate)::integer as commission_clp
  from public.reservations r
  join public.properties p on p.id = r.property_id
 where p.owner_id = public.current_owner_id()
   and r.status <> 'hold';

-- Resumen mensual por propiedad (mes del check-in) de reservas que generan ingreso.
create view public.owner_revenue_summary
with (security_invoker = false, security_barrier = true)
as
select r.property_id,
       p.name as property_name,
       date_trunc('month', r.check_in)::date as month,
       count(*)::integer as reservations,
       sum(r.nights)::integer as nights,
       sum(r.net_total_clp)::bigint as net_total_clp,
       sum(r.vat_clp)::bigint as vat_clp,
       sum(r.total_clp)::bigint as total_clp,
       sum(round(r.net_total_clp * r.commission_rate))::bigint as commission_clp
  from public.reservations r
  join public.properties p on p.id = r.property_id
 where p.owner_id = public.current_owner_id()
   and r.status in ('confirmada', 'completada')
 group by r.property_id, p.name, date_trunc('month', r.check_in);

revoke all on public.staff_properties, public.staff_reservations, public.staff_access_codes,
              public.owner_reservations, public.owner_revenue_summary
  from public, anon, authenticated;
grant select on public.staff_properties, public.staff_reservations, public.staff_access_codes,
                public.owner_reservations, public.owner_revenue_summary
  to authenticated;

-- ─── Bloqueos manuales (solo admin, vía funciones) ───────────────────────
-- Inserta un manual_block; si choca con cualquier ocupación activa, la
-- restricción occupancies_no_overlap lo rechaza (error 23P01).
create function public.create_manual_block(
  p_property_id uuid,
  p_from date,
  p_to date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede bloquear fechas' using errcode = '42501';
  end if;

  insert into public.calendar_occupancies (property_id, stay, kind, note)
  values (p_property_id, daterange(p_from, p_to, '[)'), 'manual_block', p_note)
  returning id into v_id;

  return v_id;
end;
$$;

-- No borra: deja el bloqueo como 'cancelled' para conservar el historial.
create function public.remove_manual_block(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede quitar bloqueos' using errcode = '42501';
  end if;

  update public.calendar_occupancies
     set status = 'cancelled',
         released_at = now()
   where id = p_id
     and kind = 'manual_block'
     and status = 'active';

  if not found then
    raise exception 'No existe un bloqueo manual activo con id %', p_id using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.create_manual_block(uuid, date, date, text) from public, anon;
revoke execute on function public.remove_manual_block(uuid) from public, anon;
grant execute on function public.create_manual_block(uuid, date, date, text) to authenticated;
grant execute on function public.remove_manual_block(uuid) to authenticated;

-- ─── Protección del último admin ─────────────────────────────────────────
-- Sin al menos un admin activo nadie podría administrar el sitio desde el
-- panel. El bloqueo FOR UPDATE evita que dos cambios simultáneos dejen 0.
create function public.app_users_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active) then
    perform 1 from public.app_users where role = 'admin' and is_active for update;
    if not exists (
      select 1 from public.app_users
       where role = 'admin' and is_active and id <> old.id
    ) then
      raise exception 'No se puede quitar ni desactivar al último administrador activo'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.app_users_protect_last_admin() from public, anon, authenticated;

create trigger app_users_protect_last_admin
  before update or delete on public.app_users
  for each row execute function public.app_users_protect_last_admin();
