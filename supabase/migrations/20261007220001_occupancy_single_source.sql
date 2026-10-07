-- Sesión 8 (1/2): UNA sola definición de "noche ocupada".
-- Lección de la Sesión 7: cada consulta que revisaba ocupación escribía su
-- propio filtro, y uno ignoraba los bloqueos sin reservation_id. Desde
-- ahora el calendario público (get_property_availability), el motor de
-- precios (pricing_core) y la sincronización iCal (conflictos y
-- exportación) parten de active_occupancies.
--
-- Regla: una ocupación con status 'active' ocupa sus noches, sea cual sea su
-- tipo (reserva, hold, bloqueo manual o iCal). Un hold vencido sigue
-- ocupando hasta que el job release-expired-holds lo libera (lado seguro).

create function public.active_occupancies(p_property_id uuid)
returns table (
  id uuid,
  stay daterange,
  kind public.occupancy_kind,
  reservation_id uuid,
  reservation_status public.reservation_status,
  external_calendar_id uuid,
  external_uid text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.stay, o.kind, o.reservation_id, r.status, o.external_calendar_id, o.external_uid
    from public.calendar_occupancies o
    left join public.reservations r on r.id = o.reservation_id
   where o.property_id = p_property_id
     and o.status = 'active';
$$;

-- Rangos ocupados. p_exclude_reservation_id: el checkout ignora el hold de
-- su propia reserva. Los bloqueos sin reservation_id nunca se ignoran.
create function public.occupied_ranges(p_property_id uuid, p_exclude_reservation_id uuid default null)
returns setof daterange
language sql
stable
security definer
set search_path = ''
as $$
  select a.stay
    from public.active_occupancies(p_property_id) a
   where p_exclude_reservation_id is null
      or a.reservation_id is distinct from p_exclude_reservation_id;
$$;

revoke execute on function public.active_occupancies(uuid) from public, anon, authenticated;
revoke execute on function public.occupied_ranges(uuid, uuid) from public, anon, authenticated;

-- Calendario público: misma firma y misma salida (rangos unidos), ahora
-- desde occupied_ranges.
create or replace function public.get_property_availability(p_slug text, p_from date, p_to date)
returns table (start_date date, end_date date)
language sql
stable
security definer
set search_path = ''
as $$
  with prop as (
    select id
      from public.properties
     where slug = p_slug
       and status = 'publicada'
  ),
  win as (
    select daterange(p_from, least(p_to, p_from + 548), '[)') as w
     where p_from is not null and p_to is not null and p_to > p_from
  ),
  merged as (
    select range_agg(r.stay * win.w) as m
      from prop, win, public.occupied_ranges(prop.id) r(stay)
     where r.stay && win.w
  )
  select lower(r), upper(r)
    from merged, unnest(merged.m) as r
   order by 1;
$$;

-- Motor de precios: misma firma; la revisión de "unavailable" usa occupied_ranges.
create or replace function public.pricing_core(
  p_property_id uuid,
  p_check_in date,
  p_check_out date,
  p_guests integer,
  p_exclude_reservation_id uuid default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prop public.properties%rowtype;
  v_group public.rate_groups%rowtype;
  v_today date;
  v_limit timestamp;
  v_earliest date;
  v_min_nights integer;
  v_count integer;
  v_nights jsonb;
  v_nights_total bigint;
  v_extra_guests integer;
  v_extra_total bigint;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found then
    return jsonb_build_object('quotable', false, 'reason', 'not_found');
  end if;

  -- Fechas: hoy es la fecha de Chile; misma ventana de 548 días que
  -- get_property_availability y que el frontend (AVAILABILITY_WINDOW_DAYS).
  v_today := (p_now at time zone 'America/Santiago')::date;
  if p_check_in is null or p_check_out is null
     or p_check_out <= p_check_in
     or p_check_in < v_today
     or p_check_out > v_today + 548 then
    return jsonb_build_object('quotable', false, 'reason', 'invalid_dates');
  end if;

  -- Anticipación mínima: MISMA regla que earliestCheckIn del frontend
  -- (src/lib/calendar/availability.ts). Ahora + horas (instante real),
  -- llevado a la hora de Chile y truncado al minuto; si pasa la hora de
  -- check-in de ese día, la llegada más temprana es el día siguiente.
  -- Sin hora de check-in se asume 00:00.
  v_limit := date_trunc('minute', (p_now + make_interval(hours => v_prop.min_advance_hours)) at time zone 'America/Santiago');
  v_earliest := case
                  when v_limit::time <= coalesce(v_prop.check_in_time, time '00:00') then v_limit::date
                  else v_limit::date + 1
                end;
  if p_check_in < v_earliest then
    return jsonb_build_object('quotable', false, 'reason', 'advance', 'earliest_check_in', v_earliest);
  end if;

  if p_guests is null or p_guests < 1 or (v_prop.max_guests is not null and p_guests > v_prop.max_guests) then
    return jsonb_build_object('quotable', false, 'reason', 'max_guests', 'max_guests', v_prop.max_guests);
  end if;

  select * into v_group from public.rate_groups where id = v_prop.rate_group_id;
  if not found then
    return jsonb_build_object('quotable', false, 'reason', 'no_rate');
  end if;

  -- Mínimo efectivo: el MAYOR entre la propiedad y la temporada de la noche de llegada.
  v_min_nights := greatest(
    v_prop.min_nights,
    coalesce((select s.min_nights from public.rate_seasons s
               where s.rate_group_id = v_group.id and p_check_in <@ s.dates), 1)
  );
  v_count := p_check_out - p_check_in;
  if v_count < v_min_nights then
    return jsonb_build_object('quotable', false, 'reason', 'min_nights', 'min_nights', v_min_nights);
  end if;

  -- Definición ÚNICA de noche ocupada (Sesión 8): occupied_ranges.
  if exists (
    select 1
      from public.occupied_ranges(v_prop.id, p_exclude_reservation_id) r(stay)
     where r.stay && daterange(p_check_in, p_check_out, '[)')
  ) then
    return jsonb_build_object('quotable', false, 'reason', 'unavailable', 'min_nights', v_min_nights);
  end if;

  select jsonb_agg(
           jsonb_build_object('date', d.day, 'kind', np.kind, 'season', np.season_name, 'price_clp', np.price_clp)
           order by d.day),
         sum(np.price_clp)
    into v_nights, v_nights_total
    -- timestamp SIN zona: la noche es una fecha, no depende del TimeZone del servidor.
    from generate_series(p_check_in::timestamp, (p_check_out - 1)::timestamp, interval '1 day') as g(ts)
    cross join lateral (select g.ts::date as day) d
    cross join lateral public.night_price(v_group.id, d.day) np;

  v_extra_guests := greatest(0, p_guests - v_group.included_guests);
  v_extra_total := v_extra_guests::bigint * v_group.extra_guest_gross_clp * v_count;

  return jsonb_build_object(
    'quotable', true,
    'reason', null,
    'nights', v_nights,
    'nights_count', v_count,
    'nights_clp', v_nights_total,
    'cleaning_clp', v_group.cleaning_fee_gross_clp,
    'extra_guests', v_extra_guests,
    'extra_guests_clp', v_extra_total,
    'total_clp', v_nights_total + v_group.cleaning_fee_gross_clp + v_extra_total,
    'min_nights', v_min_nights
  );
end;
$$;
