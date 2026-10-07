-- Sesión 7: motor de precios ÚNICO en la base. Lo usan el listado ("desde"),
-- la ficha (quote_stay) y, desde la Sesión 9, el checkout (pricing_core):
-- el precio mostrado y el cobrado salen del mismo cálculo.
--
-- Decisiones de René (Sesión 7):
--  * El público ve solo precios finales. quote_stay NO devuelve neto, IVA
--    ni rebaja; el desglose tributario vive solo en internal_tax_breakdown
--    (admin), para boletas y reportes.
--  * Un IVA pendiente (owners.vat_applies null) NO bloquea la cotización:
--    el precio guardado es el precio final. Solo el desglose interno queda
--    'pending'.
-- Reglas completas y ejemplo numérico: docs/precios.md.

-- ─── Modo de la rebaja del avalúo, por propietario ───────────────────────
-- precio_fijo (provisorio, a validar con el contador): el total al huésped
-- no cambia; la rebaja solo reduce la base del IVA en el desglose interno.
-- traspasar: queda declarado pero sin implementar.
create type public.avaluo_rebate_mode as enum ('precio_fijo', 'traspasar');

alter table public.owners
  add column avaluo_rebate_mode public.avaluo_rebate_mode not null default 'precio_fijo';

-- ─── Precio de una noche ─────────────────────────────────────────────────
-- Solo con la FECHA (isodow de la noche), nunca con timestamps ni la zona
-- horaria del servidor. Temporada > fin de semana > base.
create function public.night_price(p_rate_group_id uuid, p_day date)
returns table (price_clp integer, kind text, season_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when s.id is not null and wk.is_weekend and s.weekend_nightly_gross_clp is not null then s.weekend_nightly_gross_clp
           when s.id is not null then s.nightly_gross_clp
           when wk.is_weekend and g.weekend_nightly_gross_clp is not null then g.weekend_nightly_gross_clp
           else g.base_nightly_gross_clp
         end,
         case
           when s.id is not null and wk.is_weekend and s.weekend_nightly_gross_clp is not null then 'season_weekend'
           when s.id is not null then 'season'
           when wk.is_weekend and g.weekend_nightly_gross_clp is not null then 'weekend'
           else 'base'
         end,
         s.name
    from public.rate_groups g
    cross join lateral (
      select extract(isodow from p_day)::smallint = any (g.weekend_nights) as is_weekend
    ) wk
    left join public.rate_seasons s
      on s.rate_group_id = g.id
     and p_day <@ s.dates
   where g.id = p_rate_group_id;
$$;

-- ─── Núcleo del cálculo ──────────────────────────────────────────────────
-- Interno: ningún rol de cliente lo ejecuta. Parámetros solo internos:
--  * p_exclude_reservation_id: el checkout (Sesión 9) cotiza ignorando el
--    hold de su propia reserva al revisar 'unavailable'.
--  * p_now: el "ahora" (para probar los bordes de la anticipación).
-- Motivos, en este orden: invalid_dates, advance, max_guests, no_rate,
-- min_nights, unavailable.
create function public.pricing_core(
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

  if exists (
    select 1
      from public.calendar_occupancies o
     where o.property_id = v_prop.id
       and o.status = 'active'
       and o.stay && daterange(p_check_in, p_check_out, '[)')
       -- Ojo: los bloqueos manuales e iCal no tienen reservation_id (NULL).
       -- "NULL is distinct from NULL" es falso: sin esta guarda se ignorarían.
       and (p_exclude_reservation_id is null or o.reservation_id is distinct from p_exclude_reservation_id)
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

-- ─── Cotización pública ──────────────────────────────────────────────────
-- Solo propiedades publicadas. Devuelve SOLO precios finales (lista
-- blanca de claves): nada de neto, IVA, rebaja, avalúo ni owner.
create function public.quote_stay(p_slug text, p_check_in date, p_check_out date, p_guests integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_quote jsonb;
begin
  select id into v_id from public.properties where slug = p_slug and status = 'publicada';
  if v_id is null then
    return jsonb_build_object('quotable', false, 'reason', 'not_found');
  end if;

  v_quote := public.pricing_core(v_id, p_check_in, p_check_out, p_guests);
  return jsonb_strip_nulls(jsonb_build_object(
    'quotable', v_quote -> 'quotable',
    'reason', v_quote -> 'reason',
    'min_nights', v_quote -> 'min_nights',
    'nights', v_quote -> 'nights',
    'nights_count', v_quote -> 'nights_count',
    'cleaning_clp', v_quote -> 'cleaning_clp',
    'extra_guests', v_quote -> 'extra_guests',
    'extra_guests_clp', v_quote -> 'extra_guests_clp',
    'total_clp', v_quote -> 'total_clp'
  ));
end;
$$;

-- ─── Extracción de neto e IVA desde un total ─────────────────────────────
-- neto = round((T + 0,19·R) / 1,19), acotado a T; IVA = T − neto.
-- Así neto + IVA = T siempre (también con $40.000) y el IVA nunca es
-- negativo. R = base rebajada por el avalúo (0 si no aplica).
create function public.vat_extract(p_total integer, p_rebate_base integer default 0)
returns table (net_clp integer, vat_clp integer)
language sql
immutable
set search_path = ''
as $$
  select n.net, p_total - n.net
    from (select least(p_total, round((p_total + 0.19 * coalesce(p_rebate_base, 0)) / 1.19)::integer) as net) n;
$$;

-- ─── Desglose tributario INTERNO (solo admin) ────────────────────────────
-- Mismo total que el público (sale de pricing_core). tax_status:
--   pending  → vat_applies null: sin cifras (no se inventan).
--   exempt   → vat_applies false: neto = total, IVA = 0.
--   ok       → vat_applies true: rebaja del avalúo en modo precio_fijo.
--   mode_not_implemented → modo 'traspasar' (aún sin definir).
create function public.internal_tax_breakdown(
  p_property_id uuid,
  p_check_in date,
  p_check_out date,
  p_guests integer,
  p_reservation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
  v_total integer;
  v_nights integer;
  v_owner public.owners%rowtype;
  v_prop public.properties%rowtype;
  v_rate numeric;
  v_rebate integer := 0;
  v_net integer;
  v_vat integer;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el desglose tributario' using errcode = '42501';
  end if;

  v_quote := public.pricing_core(p_property_id, p_check_in, p_check_out, p_guests, p_reservation_id);
  if not (v_quote ->> 'quotable')::boolean then
    return jsonb_build_object('quotable', false, 'reason', v_quote -> 'reason');
  end if;

  v_total := (v_quote ->> 'total_clp')::integer;
  v_nights := (v_quote ->> 'nights_count')::integer;
  select * into v_prop from public.properties where id = p_property_id;
  select * into v_owner from public.owners where id = v_prop.owner_id;

  if v_owner.vat_applies is null then
    return jsonb_build_object('quotable', true, 'total_clp', v_total, 'nights_count', v_nights, 'tax_status', 'pending');
  end if;

  if not v_owner.vat_applies then
    return jsonb_build_object('quotable', true, 'total_clp', v_total, 'nights_count', v_nights, 'tax_status', 'exempt',
                              'net_clp', v_total, 'vat_clp', 0, 'avaluo_rebate_base_clp', 0);
  end if;

  if v_owner.avaluo_rebate_mode <> 'precio_fijo' then
    return jsonb_build_object('quotable', true, 'total_clp', v_total, 'nights_count', v_nights,
                              'tax_status', 'mode_not_implemented', 'avaluo_rebate_mode', v_owner.avaluo_rebate_mode);
  end if;

  -- Rebaja: 11% anual (tasa de la propiedad o del owner) del avalúo, proporcional a las noches.
  if v_owner.apply_avaluo_rebate and v_prop.avaluo_fiscal_clp is not null then
    v_rate := coalesce(v_prop.avaluo_rebate_rate, v_owner.avaluo_rebate_rate);
    v_rebate := round(v_prop.avaluo_fiscal_clp * v_rate / 365 * v_nights)::integer;
  end if;

  select e.net_clp, e.vat_clp into v_net, v_vat from public.vat_extract(v_total, v_rebate) e;
  return jsonb_build_object('quotable', true, 'total_clp', v_total, 'nights_count', v_nights, 'tax_status', 'ok',
                            'avaluo_rebate_mode', v_owner.avaluo_rebate_mode, 'avaluo_rebate_base_clp', v_rebate,
                            'net_clp', v_net, 'vat_clp', v_vat);
end;
$$;

-- ─── Precio "desde" ──────────────────────────────────────────────────────
-- Menor precio por noche (base, fin de semana o temporada) en los próximos
-- 90 días de Chile. Null si la propiedad no tiene tarifa o no está
-- publicada. La vista pública la llama por fila, y Postgres exige que quien
-- consulta la vista pueda ejecutarla: por eso solo responde por publicadas.
create function public.price_from_by_id(p_property_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select min(np.price_clp)::integer
    from public.properties p
    cross join lateral generate_series(
      ((now() at time zone 'America/Santiago')::date)::timestamp,
      ((now() at time zone 'America/Santiago')::date + 89)::timestamp,
      interval '1 day') as g(ts)
    cross join lateral public.night_price(p.rate_group_id, g.ts::date) np
   where p.id = p_property_id
     and p.status = 'publicada'
     and p.rate_group_id is not null;
$$;

create function public.public_price_from(p_slug text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select public.price_from_by_id(p.id)
    from public.properties p
   where p.slug = p_slug
     and p.status = 'publicada';
$$;

-- Una sola consulta para todas las tarjetas: la vista pública suma el
-- "desde" al final (mismas opciones de seguridad y permisos).
create or replace view public.public_properties
with (security_invoker = false, security_barrier = true)
as
select p.id,
       p.slug,
       p.name,
       p.description,
       p.city,
       p.region,
       p.neighborhood,
       p.max_guests,
       p.bedrooms,
       p.beds,
       p.bathrooms,
       p.amenities,
       p.house_rules,
       p.check_in_time,
       p.check_out_time,
       p.min_nights,
       p.property_type,
       p.self_check_in,
       p.min_advance_hours,
       public.price_from_by_id(p.id) as price_from_clp
  from public.properties p
 where p.status = 'publicada';

-- ─── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.night_price(uuid, date) from public, anon, authenticated;
revoke execute on function public.pricing_core(uuid, date, date, integer, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.vat_extract(integer, integer) from public, anon, authenticated;
revoke execute on function public.price_from_by_id(uuid) from public;
grant execute on function public.price_from_by_id(uuid) to anon, authenticated;

revoke execute on function public.quote_stay(text, date, date, integer) from public;
grant execute on function public.quote_stay(text, date, date, integer) to anon, authenticated;
revoke execute on function public.public_price_from(text) from public;
grant execute on function public.public_price_from(text) to anon, authenticated;

revoke execute on function public.internal_tax_breakdown(uuid, date, date, integer, uuid) from public, anon;
grant execute on function public.internal_tax_breakdown(uuid, date, date, integer, uuid) to authenticated;
