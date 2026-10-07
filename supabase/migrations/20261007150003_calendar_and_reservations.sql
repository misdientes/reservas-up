-- Sesión 2 (3/5): calendarios externos, reservas, ocupación del calendario
-- y registro de conflictos. Aquí vive la regla anti-doble-reserva (CLAUDE.md §4).

-- ─── external_calendars ──────────────────────────────────────────────────
create table public.external_calendars (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.properties (id) on delete restrict,
  channel          public.calendar_channel not null,
  name             text,
  import_url       text,
  -- Token para la URL de exportación de nuestro calendario hacia Airbnb/Booking.
  export_token     text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  is_active        boolean not null default true,
  last_synced_at   timestamptz,
  last_sync_status text,
  last_sync_error  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index external_calendars_property_id_idx on public.external_calendars (property_id);

-- ─── reservations ────────────────────────────────────────────────────────
create table public.reservations (
  id                  uuid primary key default gen_random_uuid(),
  -- Código corto que ve el huésped (no expone el uuid).
  code                text not null unique
                      default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  property_id         uuid not null references public.properties (id) on delete restrict,
  guest_id            uuid not null references public.guests (id) on delete restrict,
  -- Preparado para marketplace: quién es dueño, quién administra y con qué
  -- comisión, congelado al momento de reservar.
  owner_id            uuid not null references public.owners (id) on delete restrict,
  manager_id          uuid references public.managers (id) on delete restrict,
  commission_rate     numeric(5,4) not null default 0 check (commission_rate between 0 and 1),
  channel             public.reservation_channel not null default 'directo',
  status              public.reservation_status not null default 'hold',
  -- Estadía [check_in, check_out): el día de salida queda libre.
  check_in            date not null,
  check_out           date not null,
  nights              integer generated always as (check_out - check_in) stored,
  adults              integer not null default 1 check (adults >= 1),
  children            integer not null default 0 check (children >= 0),
  hold_expires_at     timestamptz,
  -- Precio desglosado, calculado siempre en el servidor (CLAUDE.md §3).
  nights_net_clp      integer not null default 0 check (nights_net_clp >= 0),
  cleaning_net_clp    integer not null default 0 check (cleaning_net_clp >= 0),
  discount_net_clp    integer not null default 0 check (discount_net_clp >= 0),
  net_total_clp       integer not null default 0 check (net_total_clp >= 0),
  avaluo_rebate_clp   integer not null default 0 check (avaluo_rebate_clp >= 0),
  vat_clp             integer not null default 0 check (vat_clp >= 0),
  total_clp           integer not null default 0 check (total_clp >= 0),
  coupon_id           uuid references public.coupons (id) on delete restrict,
  -- Consentimiento (Ley 21.719): qué versión aceptó y cuándo.
  terms_document_id   uuid references public.legal_documents (id) on delete restrict,
  privacy_document_id uuid references public.legal_documents (id) on delete restrict,
  consent_at          timestamptz,
  confirmed_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint reservations_dates_valid check (check_out > check_in),
  constraint reservations_hold_has_expiry check (status <> 'hold' or hold_expires_at is not null)
);

create index reservations_property_id_idx on public.reservations (property_id, check_in);
create index reservations_guest_id_idx on public.reservations (guest_id);
create index reservations_hold_expiry_idx on public.reservations (hold_expires_at) where status = 'hold';

-- ─── calendar_occupancies ────────────────────────────────────────────────
-- Tabla única de todo lo que ocupa noches: reservas, holds de pago, bloqueos
-- manuales e imports iCal. Al estar todo aquí, una sola restricción protege
-- contra cualquier combinación de doble venta.
create table public.calendar_occupancies (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties (id) on delete restrict,
  stay                 daterange not null,
  kind                 public.occupancy_kind not null,
  status               public.occupancy_status not null default 'active',
  expires_at           timestamptz,
  reservation_id       uuid unique references public.reservations (id) on delete restrict,
  external_calendar_id uuid references public.external_calendars (id) on delete restrict,
  external_uid         text,
  note                 text,
  released_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint occupancies_stay_valid
    check (not isempty(stay) and lower(stay) is not null and upper(stay) is not null),
  constraint occupancies_hold_has_expiry
    check (kind <> 'hold' or expires_at is not null),
  constraint occupancies_reservation_link
    check ((kind in ('reservation', 'hold')) = (reservation_id is not null)),
  constraint occupancies_ical_link
    check ((kind = 'ical_block') = (external_calendar_id is not null and external_uid is not null)),
  -- REGLA ANTI-DOBLE-RESERVA: dos ocupaciones activas de la misma propiedad
  -- no pueden compartir ninguna noche. La base lo rechaza aunque dos
  -- procesos lo intenten al mismo tiempo.
  constraint occupancies_no_overlap
    exclude using gist (property_id with =, stay with &&) where (status = 'active')
);

-- Idempotencia del import iCal (Sesión 8): el mismo evento externo no se
-- inserta dos veces mientras esté activo.
create unique index occupancies_external_uid_idx
  on public.calendar_occupancies (external_calendar_id, external_uid)
  where status = 'active' and external_uid is not null;

-- ─── calendar_conflicts ──────────────────────────────────────────────────
-- Bloqueos externos rechazados porque chocan con una ocupación existente
-- (por ejemplo, Airbnb vendió noches que ya tenían una reserva directa pagada).
create table public.calendar_conflicts (
  id                       uuid primary key default gen_random_uuid(),
  property_id              uuid not null references public.properties (id) on delete restrict,
  external_calendar_id     uuid references public.external_calendars (id) on delete restrict,
  external_uid             text,
  rejected_stay            daterange not null,
  summary                  text,
  conflicting_occupancy_id uuid not null references public.calendar_occupancies (id) on delete restrict,
  reservation_id           uuid references public.reservations (id) on delete restrict,
  detected_at              timestamptz not null default now(),
  notified_at              timestamptz,
  resolved_at              timestamptz,
  resolution               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- El import corre cada 10-15 minutos: un mismo choque abierto se registra una sola vez.
create unique index calendar_conflicts_open_idx
  on public.calendar_conflicts (external_calendar_id, external_uid, conflicting_occupancy_id)
  where resolved_at is null;

-- ─── RLS, permisos y updated_at ──────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['external_calendars', 'reservations', 'calendar_occupancies', 'calendar_conflicts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

-- ─── Sincronización reserva → ocupación ──────────────────────────────────
-- Toda reserva no cancelada tiene exactamente una ocupación activa, creada
-- en la misma transacción. Si las noches no están libres, la reserva entera
-- falla: no puede existir una reserva sin sus noches bloqueadas.
-- SECURITY DEFINER: así los roles de cliente nunca necesitarán escribir
-- directamente ocupaciones de tipo reservation/hold (Sesión 3).
create function public.sync_reservation_occupancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelada' then
    -- Un hold vencido queda "released"; cualquier otra anulación, "cancelled".
    update public.calendar_occupancies
       set status = case when new.cancellation_reason = 'hold_expirado'
                         then 'released'::public.occupancy_status
                         else 'cancelled'::public.occupancy_status end,
           released_at = now()
     where reservation_id = new.id
       and status = 'active';
  else
    -- hold → ocupación hold con vencimiento; confirmada/completada/conflicto
    -- → ocupación reservation. Al confirmar se actualiza la MISMA fila, así
    -- que las noches nunca quedan libres entre el hold y la confirmación.
    insert into public.calendar_occupancies (property_id, stay, kind, status, expires_at, reservation_id)
    values (
      new.property_id,
      daterange(new.check_in, new.check_out, '[)'),
      case when new.status = 'hold' then 'hold'::public.occupancy_kind
           else 'reservation'::public.occupancy_kind end,
      'active',
      case when new.status = 'hold' then new.hold_expires_at end,
      new.id
    )
    on conflict (reservation_id) do update
       set property_id = excluded.property_id,
           stay        = excluded.stay,
           kind        = excluded.kind,
           status      = 'active',
           expires_at  = excluded.expires_at,
           released_at = null;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_reservation_occupancy() from public, anon, authenticated;

create trigger reservations_sync_occupancy
  after insert or update of status, property_id, check_in, check_out, hold_expires_at, cancellation_reason
  on public.reservations
  for each row execute function public.sync_reservation_occupancy();

-- ─── Protocolo de conflicto ──────────────────────────────────────────────
-- La llamará el import iCal (Sesión 8) cuando un evento externo choque con
-- la restricción occupancies_no_overlap (error 23P01). Registra el choque
-- contra cada ocupación activa solapada y pasa a 'conflicto' las reservas
-- confirmadas afectadas. Sus noches siguen bloqueadas (siguen vendidas);
-- el aviso a René y el reembolso son de las Sesiones 10, 11 y 15.
-- Devuelve cuántos choques nuevos se registraron (0 si ya estaban abiertos).
create function public.register_calendar_conflict(
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
    select o.id, o.reservation_id
      from public.calendar_occupancies o
     where o.property_id = v_property_id
       and o.status = 'active'
       and o.stay && p_stay
       -- Un evento no choca consigo mismo si ya está importado.
       and not (o.external_calendar_id is not distinct from p_external_calendar_id
                and o.external_uid is not distinct from p_external_uid)
  ),
  inserted as (
    insert into public.calendar_conflicts (
      property_id, external_calendar_id, external_uid, rejected_stay, summary,
      conflicting_occupancy_id, reservation_id
    )
    select v_property_id, p_external_calendar_id, p_external_uid, p_stay, p_summary, c.id, c.reservation_id
      from conflicting c
    on conflict (external_calendar_id, external_uid, conflicting_occupancy_id)
      where resolved_at is null
      do nothing
    returning reservation_id
  )
  select count(*) into v_count from inserted;

  -- Solo una reserva confirmada (pagada) pasa a conflicto. Un hold sin pagar
  -- queda registrado en calendar_conflicts y la Sesión 9/10 lo revalida
  -- antes de cobrar.
  update public.reservations r
     set status = 'conflicto'
   where r.status = 'confirmada'
     and r.id in (
       select o.reservation_id
         from public.calendar_occupancies o
        where o.property_id = v_property_id
          and o.status = 'active'
          and o.stay && p_stay
          and o.reservation_id is not null
     );

  return v_count;
end;
$$;

revoke execute on function public.register_calendar_conflict(uuid, text, daterange, text) from public, anon, authenticated;
