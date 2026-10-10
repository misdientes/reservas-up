-- Sesión 13: panel de tarifas, temporadas, descuentos, bloqueos e iCal.
-- Decisiones de René:
--  (a) Precio por día: 7 precios opcionales (lunes … domingo) por tarifa y
--      por temporada; vacío = precio base / de la temporada. Reemplaza al
--      "precio de fin de semana" (weekend_nights + weekend_nightly_gross_clp).
--  (b) Temporadas con prioridad explícita (1 Normal, 2 Alta, 3 Máxima):
--      manda la mayor; dos de la misma prioridad no pueden cruzarse.
--  (c) Descuento por estadía larga sobre noches + huéspedes extra (sin el
--      aseo); se aplica un solo tramo: el mayor que alcance la estadía.
-- Siguen valiendo: UN solo motor (pricing_core, que usa night_price) y UNA
-- sola definición de noche ocupada (active_occupancies / occupied_ranges).
-- Ajustes de René al aprobar: paridad de precios verificada ANTES de borrar
-- las columnas de fin de semana, y ninguna regla con now()/current_date en
-- un CHECK (van en triggers BEFORE … OF <fechas>).

-- ─── 0. Paridad: foto de los precios con la lógica ANTERIOR ──────────────
-- Precio de cada noche de los próximos 365 días por grupo de tarifa, y
-- mínimo de noches por propiedad y día de llegada. Al final de la sección 3
-- se compara con la lógica nueva; si una sola noche difiere, la migración
-- entera se cancela (RAISE EXCEPTION) y nada cambia.
create temp table s13_parity_prices as
select g.id as rate_group_id, s.ts::date as day, np.price_clp
  from public.rate_groups g
  cross join lateral generate_series(((now() at time zone 'America/Santiago')::date)::timestamp,
                                     ((now() at time zone 'America/Santiago')::date + 364)::timestamp,
                                     interval '1 day') s(ts)
  cross join lateral public.night_price(g.id, s.ts::date) np;

create temp table s13_parity_min_nights as
select p.id as property_id, s.ts::date as day,
       greatest(p.min_nights,
                coalesce((select x.min_nights from public.rate_seasons x
                           where x.rate_group_id = p.rate_group_id and s.ts::date <@ x.dates), 1)) as min_nights
  from public.properties p
  cross join lateral generate_series(((now() at time zone 'America/Santiago')::date)::timestamp,
                                     ((now() at time zone 'America/Santiago')::date + 364)::timestamp,
                                     interval '1 day') s(ts)
 where p.rate_group_id is not null;

-- ─── 1. Tarifas y temporadas: columnas nuevas y migración de datos ───────
-- Validación de los 7 precios por día (posición 1 = lunes … 7 = domingo,
-- día ISO de la NOCHE). Función para poder usarla en un CHECK.
create function public.dow_prices_ok(p integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null
      or (array_ndims(p) = 1 and array_lower(p, 1) = 1 and cardinality(p) = 7
          and not exists (select 1 from unnest(p) x where x is not null and x not between 1000 and 5000000));
$$;

alter table public.rate_groups
  add column dow_gross_clp integer[],
  add column min_nights integer;

alter table public.rate_seasons
  add column dow_gross_clp integer[],
  add column priority smallint not null default 1;

comment on column public.rate_groups.dow_gross_clp is
  'Precio CON IVA por día ISO de la noche (1 = lunes … 7 = domingo); null en una posición = precio base.';
comment on column public.rate_groups.min_nights is
  'Noches mínimas de la tarifa (null = 1). Una temporada con mínimo propio la reemplaza; la propiedad es un piso.';
comment on column public.rate_seasons.dow_gross_clp is
  'Precio CON IVA por día ISO de la noche dentro de la temporada; null en una posición = precio de la temporada.';
comment on column public.rate_seasons.priority is
  '1 Normal, 2 Alta, 3 Máxima. Si dos temporadas cubren la misma noche, manda la de mayor prioridad.';

-- El precio de fin de semana pasa a los días que lo usaban.
update public.rate_groups g
   set dow_gross_clp = (select array_agg(case when d::smallint = any (g.weekend_nights) then g.weekend_nightly_gross_clp end order by d)
                          from generate_series(1, 7) d)
 where g.weekend_nightly_gross_clp is not null;

update public.rate_seasons s
   set dow_gross_clp = (select array_agg(case when d::smallint = any (g.weekend_nights) then s.weekend_nightly_gross_clp end order by d)
                          from generate_series(1, 7) d)
  from public.rate_groups g
 where g.id = s.rate_group_id
   and s.weekend_nightly_gross_clp is not null;

-- ─── 2. Precio de una noche (única fuente) ───────────────────────────────
-- Temporada ganadora: la de mayor prioridad que contiene la noche
-- (desempate determinista: la más corta y luego el id). Orden del precio:
-- día de la temporada > temporada > día de la tarifa > base.
-- Devuelve además la temporada ganadora (para el mínimo de noches y el
-- calendario del panel): nadie más vuelve a elegir temporadas.
drop function public.night_price(uuid, date);
create function public.night_price(p_rate_group_id uuid, p_day date)
returns table (
  price_clp integer,
  kind text,
  season_name text,
  season_id uuid,
  season_priority smallint,
  season_min_nights integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when s.id is not null and s.dow_gross_clp[d.dow] is not null then s.dow_gross_clp[d.dow]
           when s.id is not null then s.nightly_gross_clp
           when g.dow_gross_clp[d.dow] is not null then g.dow_gross_clp[d.dow]
           else g.base_nightly_gross_clp
         end,
         case
           when s.id is not null and s.dow_gross_clp[d.dow] is not null then 'season_dow'
           when s.id is not null then 'season'
           when g.dow_gross_clp[d.dow] is not null then 'dow'
           else 'base'
         end,
         s.name, s.id, s.priority, s.min_nights
    from public.rate_groups g
    -- Solo con la FECHA (día ISO de la noche), nunca con timestamps.
    cross join lateral (select extract(isodow from p_day)::integer as dow) d
    left join lateral (
      select x.id, x.name, x.priority, x.min_nights, x.nightly_gross_clp, x.dow_gross_clp
        from public.rate_seasons x
       where x.rate_group_id = g.id
         and p_day <@ x.dates
       order by x.priority desc, upper(x.dates) - lower(x.dates), x.id
       limit 1
    ) s on true
   where g.id = p_rate_group_id;
$$;

-- Mínimo de noches efectivo para una llegada: el mayor entre la propiedad y
-- (temporada ganadora de la noche de llegada, o si no tiene, la tarifa).
-- Única definición: la usan pricing_core y el calendario del panel.
create function public.effective_min_nights(p_property_id uuid, p_check_in date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(p.min_nights, coalesce(np.season_min_nights, g.min_nights, 1))
    from public.properties p
    join public.rate_groups g on g.id = p.rate_group_id
    cross join lateral public.night_price(g.id, p_check_in) np
   where p.id = p_property_id;
$$;

-- ─── 3. Paridad: comparar y recién entonces borrar lo anterior ───────────
do $$
declare
  v_groups integer;
  v_nights integer;
  v_price_diff integer;
  v_props integer;
  v_min_diff integer;
  v_example text;
begin
  select count(distinct rate_group_id), count(*) into v_groups, v_nights from s13_parity_prices;

  select count(*), min(format('grupo %s, noche %s: antes %s, ahora %s', o.rate_group_id, o.day, o.price_clp, np.price_clp))
    into v_price_diff, v_example
    from s13_parity_prices o
    left join lateral public.night_price(o.rate_group_id, o.day) np on true
   where np.price_clp is distinct from o.price_clp;
  if v_price_diff > 0 then
    raise exception 'Paridad de precios: % noche(s) cambian de precio (ej. %). Migración cancelada.', v_price_diff, v_example;
  end if;

  select count(distinct property_id) into v_props from s13_parity_min_nights;
  select count(*), min(format('propiedad %s, llegada %s: antes %s, ahora %s', o.property_id, o.day, o.min_nights,
                              public.effective_min_nights(o.property_id, o.day)))
    into v_min_diff, v_example
    from s13_parity_min_nights o
   where public.effective_min_nights(o.property_id, o.day) is distinct from o.min_nights;
  if v_min_diff > 0 then
    raise exception 'Paridad de noches mínimas: % llegada(s) cambian (ej. %). Migración cancelada.', v_min_diff, v_example;
  end if;

  raise notice 'Paridad OK: % grupo(s) de tarifa, % noche(s) con el mismo precio; % propiedad(es), % día(s) de llegada con el mismo mínimo.',
    v_groups, v_nights, v_props, (select count(*) from s13_parity_min_nights);
end;
$$;

drop table s13_parity_prices;
drop table s13_parity_min_nights;

alter table public.rate_groups
  drop column weekend_nights,
  drop column weekend_nightly_gross_clp;
alter table public.rate_seasons
  drop column weekend_nightly_gross_clp;

-- ─── 4. Límites razonables (validación en el servidor) ───────────────────
-- Precio > 0 (decisión de René): mínimo $1.000 por noche, máximo $5.000.000.
alter table public.rate_groups
  add constraint rate_groups_base_range check (base_nightly_gross_clp between 1000 and 5000000),
  add constraint rate_groups_dow_valid check (public.dow_prices_ok(dow_gross_clp)),
  add constraint rate_groups_cleaning_max check (cleaning_fee_gross_clp <= 1000000),
  add constraint rate_groups_included_max check (included_guests <= 30),
  add constraint rate_groups_extra_max check (extra_guest_gross_clp <= 500000),
  add constraint rate_groups_min_nights_range check (min_nights between 1 and 60),
  add constraint rate_groups_name_length check (char_length(btrim(name)) between 2 and 80);

alter table public.rate_seasons
  add constraint rate_seasons_price_range check (nightly_gross_clp between 1000 and 5000000),
  add constraint rate_seasons_dow_valid check (public.dow_prices_ok(dow_gross_clp)),
  add constraint rate_seasons_min_nights_max check (min_nights <= 60),
  add constraint rate_seasons_priority_range check (priority between 1 and 3),
  add constraint rate_seasons_length check (upper(dates) - lower(dates) <= 370),
  add constraint rate_seasons_name_length check (char_length(btrim(name)) between 2 and 80);

-- Solo se cruzan temporadas de DISTINTA prioridad.
alter table public.rate_seasons drop constraint rate_seasons_no_overlap;
alter table public.rate_seasons
  add constraint rate_seasons_no_overlap
  exclude using gist (rate_group_id with =, priority with =, dates with &&);

-- Fechas relativas a "hoy": en un trigger, nunca en un CHECK (now() no es
-- inmutable). Solo cuando cambian las fechas: editar el nombre o el precio
-- de una temporada pasada no se bloquea.
create function public.rate_seasons_dates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Santiago')::date;
begin
  if tg_op = 'UPDATE' and new.dates = old.dates then
    return new;
  end if;
  if upper(new.dates) <= v_today then
    raise exception 'La temporada ya terminó: elige fechas desde hoy en adelante.'
      using errcode = 'P0001', hint = 'temporada_pasada';
  end if;
  -- Última noche (upper - 1) dentro de los próximos 2 años.
  if upper(new.dates) - 1 > (v_today + interval '2 years')::date then
    raise exception 'La temporada debe terminar dentro de los próximos 2 años.'
      using errcode = 'P0001', hint = 'temporada_lejana';
  end if;
  return new;
end;
$$;

create trigger rate_seasons_dates_guard before insert or update of dates on public.rate_seasons
  for each row execute function public.rate_seasons_dates_guard();

-- ─── 5. Descuentos por estadía larga ─────────────────────────────────────
create table public.rate_long_stay_discounts (
  id            uuid primary key default gen_random_uuid(),
  rate_group_id uuid not null references public.rate_groups (id) on delete cascade,
  min_nights    integer not null check (min_nights between 2 and 365),
  percent       integer not null check (percent between 1 and 60),
  created_at    timestamptz not null default now(),
  constraint rate_long_stay_discounts_tier_key unique (rate_group_id, min_nights)
);

comment on table public.rate_long_stay_discounts is
  'Tramos de descuento por estadía larga: desde min_nights noches, percent % sobre noches + huéspedes extra (sin aseo). Se aplica el mayor tramo alcanzado.';

alter table public.rate_long_stay_discounts enable row level security;
revoke all on public.rate_long_stay_discounts from public, anon, authenticated;
grant select, insert, update, delete on public.rate_long_stay_discounts to authenticated;
create policy admin_all on public.rate_long_stay_discounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── 6. Motor de precios (misma firma; descuento DENTRO del motor) ───────
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
  v_discount_percent integer;
  v_discount bigint := 0;
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
  -- (src/lib/calendar/availability.ts).
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

  v_min_nights := public.effective_min_nights(v_prop.id, p_check_in);
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

  -- Descuento por estadía larga (decisión c): el mayor tramo alcanzado,
  -- sobre noches + huéspedes extra; el aseo no se descuenta. Pesos enteros.
  select t.percent into v_discount_percent
    from public.rate_long_stay_discounts t
   where t.rate_group_id = v_group.id
     and t.min_nights <= v_count
   order by t.min_nights desc
   limit 1;
  if v_discount_percent is not null then
    v_discount := round((v_nights_total + v_extra_total) * v_discount_percent / 100.0);
  end if;

  return jsonb_build_object(
    'quotable', true,
    'reason', null,
    'nights', v_nights,
    'nights_count', v_count,
    'nights_clp', v_nights_total,
    'cleaning_clp', v_group.cleaning_fee_gross_clp,
    'extra_guests', v_extra_guests,
    'extra_guests_clp', v_extra_total,
    'long_stay_discount_percent', v_discount_percent,
    'long_stay_discount_clp', case when v_discount_percent is not null then v_discount end,
    'total_clp', v_nights_total + v_group.cleaning_fee_gross_clp + v_extra_total - v_discount,
    'min_nights', v_min_nights
  );
end;
$$;

-- Forma PÚBLICA de una cotización (lista blanca de claves): solo precios
-- finales. La usan quote_stay y el simulador del panel, así el admin ve
-- exactamente lo mismo que el huésped.
create function public.public_quote_shape(p_quote jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'quotable', p_quote -> 'quotable',
    'reason', p_quote -> 'reason',
    'min_nights', p_quote -> 'min_nights',
    'nights', p_quote -> 'nights',
    'nights_count', p_quote -> 'nights_count',
    'cleaning_clp', p_quote -> 'cleaning_clp',
    'extra_guests', p_quote -> 'extra_guests',
    'extra_guests_clp', p_quote -> 'extra_guests_clp',
    'long_stay_discount_percent', p_quote -> 'long_stay_discount_percent',
    'long_stay_discount_clp', p_quote -> 'long_stay_discount_clp',
    'total_clp', p_quote -> 'total_clp'
  ));
$$;

create or replace function public.quote_stay(p_slug text, p_check_in date, p_check_out date, p_guests integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.properties where slug = p_slug and status = 'publicada';
  if v_id is null then
    return jsonb_build_object('quotable', false, 'reason', 'not_found');
  end if;
  return public.public_quote_shape(public.pricing_core(v_id, p_check_in, p_check_out, p_guests));
end;
$$;

-- Simulador del panel: lo que vería el huésped (aunque la propiedad esté en
-- borrador) + plan de pago + desglose interno. Solo admin.
create function public.admin_quote(p_property_id uuid, p_check_in date, p_check_out date, p_guests integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  v_quote := public.pricing_core(p_property_id, p_check_in, p_check_out, p_guests);
  if not coalesce((v_quote ->> 'quotable')::boolean, false) then
    return jsonb_build_object('public', public.public_quote_shape(v_quote));
  end if;
  return jsonb_build_object(
    'public', public.public_quote_shape(v_quote),
    'plan', public.payment_plan_core(p_property_id, p_check_in, (v_quote ->> 'total_clp')::integer, v_quote -> 'nights'),
    'internal', public.internal_tax_breakdown(p_property_id, p_check_in, p_check_out, p_guests)
  );
end;
$$;

-- ─── 7. Bloqueos manuales con motivo ─────────────────────────────────────
create type public.block_reason as enum ('mantencion', 'uso_dueno', 'otro');

alter table public.calendar_occupancies
  add column block_reason public.block_reason,
  add constraint occupancies_block_reason_kind check (block_reason is null or kind = 'manual_block');

update public.calendar_occupancies set block_reason = 'otro' where kind = 'manual_block' and block_reason is null;

-- Fechas relativas a hoy (trigger, no CHECK): un bloqueo nuevo no puede
-- empezar en el pasado y dura como máximo 366 noches. Los rangos vacíos o
-- abiertos los rechaza el CHECK occupancies_stay_valid.
create function public.manual_block_dates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Santiago')::date;
begin
  if new.kind <> 'manual_block' or isempty(new.stay) or lower(new.stay) is null or upper(new.stay) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.stay = old.stay then
    return new;
  end if;
  if lower(new.stay) < v_today then
    raise exception 'Un bloqueo no puede empezar en el pasado.' using errcode = 'P0001', hint = 'bloqueo_pasado';
  end if;
  if upper(new.stay) - lower(new.stay) > 366 then
    raise exception 'Un bloqueo puede durar como máximo 366 noches.' using errcode = 'P0001', hint = 'bloqueo_largo';
  end if;
  return new;
end;
$$;

create trigger calendar_occupancies_manual_block_dates before insert or update of stay on public.calendar_occupancies
  for each row execute function public.manual_block_dates_guard();

drop function public.create_manual_block(uuid, date, date, text);
create function public.create_manual_block(
  p_property_id uuid,
  p_from date,
  p_to date,
  p_note text default null,
  p_reason public.block_reason default 'otro'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_detail text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede bloquear fechas' using errcode = '42501';
  end if;
  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'La propiedad no existe.' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'La fecha de término debe ser posterior a la de inicio.' using errcode = 'P0001', hint = 'bloqueo_fechas';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'La nota puede tener como máximo 300 caracteres.' using errcode = 'P0001', hint = 'bloqueo_nota';
  end if;

  begin
    insert into public.calendar_occupancies (property_id, stay, kind, note, block_reason)
    values (p_property_id, daterange(p_from, p_to, '[)'), 'manual_block', nullif(btrim(p_note), ''), coalesce(p_reason, 'otro'))
    returning id into v_id;
  exception when exclusion_violation then
    -- La restricción de exclusión decide; aquí solo se explica con qué choca
    -- (definición única de noche ocupada).
    select string_agg(format('%s (del %s al %s)',
                             case a.kind
                               when 'reservation' then 'una reserva'
                               when 'hold' then 'una reserva en proceso de pago'
                               when 'manual_block' then 'otro bloqueo'
                               else 'un bloqueo de Airbnb/Booking'
                             end,
                             to_char(lower(a.stay), 'DD-MM-YYYY'), to_char(upper(a.stay), 'DD-MM-YYYY')),
                      ', ' order by lower(a.stay))
      into v_detail
      from public.active_occupancies(p_property_id) a
     where a.stay && daterange(p_from, p_to, '[)');
    raise exception 'Esas fechas chocan con %. Elige otras fechas o libera primero esas noches.', coalesce(v_detail, 'otra ocupación')
      using errcode = 'P0001', hint = 'bloqueo_choca';
  end;

  return v_id;
end;
$$;

-- ─── 8. Calendarios iCal ─────────────────────────────────────────────────
-- Misma regla que isAllowedUrl (supabase/functions/_shared/ical.ts): https,
-- sin usuario/clave y host dentro de la lista permitida ("airbnb.*" admite
-- airbnb.cl, airbnb.com, airbnb.com.ar…).
create function public.ical_url_allowed(p_url text, p_allowed text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
  v_pattern text;
begin
  if p_url is null or p_url !~* '^https://' or char_length(p_url) > 2000 then
    return false;
  end if;
  v_authority := lower(substring(p_url from '^[hH][tT][tT][pP][sS]://([^/?#]*)'));
  if v_authority is null or v_authority = '' or position('@' in v_authority) > 0 then
    return false;
  end if;
  v_host := split_part(v_authority, ':', 1);
  foreach v_pattern in array string_to_array(lower(coalesce(p_allowed, '')), ',') loop
    v_pattern := btrim(v_pattern);
    continue when v_pattern = '';
    if right(v_pattern, 2) = '.*' then
      if v_host ~ ('^([a-z0-9-]+\.)*' || replace(left(v_pattern, -2), '.', '\.') || '\.[a-z]{2,3}(\.[a-z]{2})?$') then
        return true;
      end if;
    elsif v_host = v_pattern or right(v_host, char_length(v_pattern) + 1) = '.' || v_pattern then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Solo para lo que escribe el panel (la importación ya valida al descargar).
create function public.external_calendars_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_api_write() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.import_url is not distinct from old.import_url and new.name is not distinct from old.name then
    return new;
  end if;
  -- Corre con el rol del panel (admin): lee la lista directo de app_settings
  -- (la política admin_all lo permite), mismo valor por defecto que ical_allowed_hosts.
  if not public.ical_url_allowed(new.import_url,
           coalesce((select value from public.app_settings where key = 'ical_allowed_hosts'), 'airbnb.*,booking.com,google.com')) then
    raise exception 'La dirección del calendario no es válida: debe empezar con https:// y ser de Airbnb o Booking.'
      using errcode = 'P0001', hint = 'ical_url_invalida';
  end if;
  if char_length(coalesce(new.name, '')) > 80 then
    raise exception 'El nombre puede tener como máximo 80 caracteres.' using errcode = 'P0001', hint = 'ical_nombre';
  end if;
  return new;
end;
$$;

create trigger external_calendars_guard before insert or update of import_url, name on public.external_calendars
  for each row execute function public.external_calendars_guard();

-- Lista para el panel: la URL de importación NUNCA sale completa (lleva un
-- token privado del canal). El export_token sí: es para pegarlo en Airbnb.
create function public.admin_external_calendars(p_property_id uuid)
returns table (
  id uuid, channel text, name text, url_masked text, is_active boolean, export_token text,
  status text, minutes_since_success integer, last_attempt_at timestamptz, last_success_at timestamptz,
  last_sync_error text, open_conflicts_reserva integer, open_conflicts_hold integer, covered_events integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  return query
    select c.id, c.channel::text, c.name,
           coalesce(substring(c.import_url from '^https://[^/?#]+'), 'https://…') || '/••••' || right(regexp_replace(c.import_url, '\.ics$', ''), 4),
           c.is_active, c.export_token, h.status, h.minutes_since_success, c.last_attempt_at, c.last_success_at,
           c.last_sync_error, h.open_conflicts_reserva, h.open_conflicts_hold, h.covered_events, c.updated_at
      from public.external_calendars c
      join public.sync_health h on h.calendar_id = c.id
     where c.property_id = p_property_id
     order by c.created_at;
end;
$$;

-- Choques abiertos de una propiedad (calendar_conflicts), para explicarlos.
create function public.admin_calendar_conflicts(p_property_id uuid)
returns table (
  id uuid, channel text, calendar_name text, conflict_type text, check_in date, check_out date,
  reservation_code text, detected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  return query
    select k.id, c.channel::text, c.name, k.conflict_type::text, lower(k.rejected_stay), upper(k.rejected_stay),
           r.code, k.detected_at
      from public.calendar_conflicts k
      join public.external_calendars c on c.id = k.external_calendar_id
      left join public.reservations r on r.id = k.reservation_id
     where k.property_id = p_property_id
       and k.resolved_at is null
     order by k.detected_at desc;
end;
$$;

-- "Sincronizar ahora" (Edge Function ical-import con el JWT del admin):
-- revisa permiso y una pausa mínima de 60 s por propiedad, y marca el
-- intento. FOR UPDATE sobre la propiedad: dos clics simultáneos no pasan
-- los dos. La importación en sí sigue el MISMO camino que el job
-- (syncProperty → apply_ical_import, con su FOR UPDATE por calendario).
create function public.admin_claim_ical_sync(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  perform 1 from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not exists (select 1 from public.external_calendars where property_id = p_property_id and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'no_calendars');
  end if;
  select max(last_attempt_at) into v_last
    from public.external_calendars where property_id = p_property_id and is_active;
  if v_last > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
                              'retry_after_seconds', ceil(extract(epoch from v_last + interval '60 seconds' - now()))::integer);
  end if;
  update public.external_calendars set last_attempt_at = now()
   where property_id = p_property_id and is_active;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── 9. Calendario de precios del panel ──────────────────────────────────
-- Una fila por noche: precio, temporada (night_price), mínimo si se llega
-- ese día (effective_min_nights) y ocupación (active_occupancies). No
-- reimplementa ninguna regla: solo junta las fuentes únicas.
create function public.admin_price_calendar(p_property_id uuid, p_from date, p_to date)
returns table (
  day date, price_clp integer, kind text, season_name text, season_priority smallint, min_nights integer,
  occupancy_id uuid, occupancy_kind text, reservation_status text, block_reason text, block_note text, channel text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 400 then
    raise exception 'Rango de fechas inválido (máximo 400 días).' using errcode = 'P0001', hint = 'calendario_rango';
  end if;
  select rate_group_id into v_group from public.properties where id = p_property_id;
  return query
    with occ as (select * from public.active_occupancies(p_property_id))
    select d.day, np.price_clp, np.kind, np.season_name, np.season_priority,
           case when v_group is not null then public.effective_min_nights(p_property_id, d.day) end,
           o.id, o.kind::text, o.reservation_status::text, co.block_reason::text, co.note, ec.channel::text
      from generate_series(p_from::timestamp, (p_to - 1)::timestamp, interval '1 day') g(ts)
      cross join lateral (select g.ts::date as day) d
      left join lateral public.night_price(v_group, d.day) np on true
      left join lateral (select x.* from occ x where d.day <@ x.stay order by x.id limit 1) o on true
      left join public.calendar_occupancies co on co.id = o.id
      left join public.external_calendars ec on ec.id = o.external_calendar_id
     order by d.day;
end;
$$;

-- ─── 10. Concurrencia optimista e historial ──────────────────────────────
-- Tarifas y temporadas: misma guardia que la ficha de propiedad (S12).
-- external_calendars NO la usa: la sincronización lo actualiza cada 10
-- minutos y el formulario quedaría siempre "desactualizado".
drop trigger rate_groups_set_updated_at on public.rate_groups;
drop trigger rate_seasons_set_updated_at on public.rate_seasons;
create trigger rate_groups_concurrency_guard before update on public.rate_groups
  for each row execute function public.concurrency_guard();
create trigger rate_seasons_concurrency_guard before update on public.rate_seasons
  for each row execute function public.concurrency_guard();

-- audit_changes: argumento opcional = columna que identifica el registro en
-- el historial (temporadas y descuentos → su tarifa; bloqueos y calendarios
-- → su propiedad). Los campos que actualiza la sincronización iCal no son
-- cambios del admin y no se registran. Siguen siendo solo NOMBRES de campos
-- (la URL del iCal nunca se guarda).
create or replace function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_key text := tg_argv[0];
  v_fields text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_fields
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at', 'last_synced_at', 'last_attempt_at', 'last_success_at', 'last_sync_status',
                     'last_sync_error', 'last_sync_summary', 'missing_since', 'missing_count')
       and v_new -> k is distinct from v_old -> k;
    if cardinality(v_fields) = 0 then
      return new;
    end if;
  else
    v_fields := '{}';
  end if;
  insert into public.admin_audit_log (actor, table_name, record_id, operation, changed_fields)
  values ((select auth.uid()), tg_table_name,
          coalesce(case when v_key is not null then coalesce(v_new ->> v_key, v_old ->> v_key) end,
                   v_new ->> 'id', v_old ->> 'id', v_new ->> 'property_id', v_old ->> 'property_id'),
          tg_op, v_fields);
  return coalesce(new, old);
end;
$$;

create trigger rate_groups_audit after insert or update or delete on public.rate_groups
  for each row execute function public.audit_changes();
create trigger rate_seasons_audit after insert or update or delete on public.rate_seasons
  for each row execute function public.audit_changes('rate_group_id');
create trigger rate_long_stay_discounts_audit after insert or update or delete on public.rate_long_stay_discounts
  for each row execute function public.audit_changes('rate_group_id');
create trigger external_calendars_audit after insert or update or delete on public.external_calendars
  for each row execute function public.audit_changes('property_id');
-- Solo bloqueos manuales: las ocupaciones de reservas e iCal no son cambios del admin.
create trigger calendar_occupancies_audit after insert or update on public.calendar_occupancies
  for each row when (new.kind = 'manual_block') execute function public.audit_changes('property_id');

-- ─── 11. Permisos ────────────────────────────────────────────────────────
revoke execute on function public.dow_prices_ok(integer[]) from public, anon;
grant execute on function public.dow_prices_ok(integer[]) to authenticated;
revoke execute on function public.night_price(uuid, date) from public, anon, authenticated;
revoke execute on function public.effective_min_nights(uuid, date) from public, anon, authenticated;
revoke execute on function public.public_quote_shape(jsonb) from public, anon, authenticated;
revoke execute on function public.rate_seasons_dates_guard() from public, anon, authenticated;
revoke execute on function public.manual_block_dates_guard() from public, anon, authenticated;
revoke execute on function public.external_calendars_guard() from public, anon, authenticated;
revoke execute on function public.ical_url_allowed(text, text) from public, anon;
grant execute on function public.ical_url_allowed(text, text) to authenticated;

revoke execute on function public.admin_quote(uuid, date, date, integer) from public, anon;
grant execute on function public.admin_quote(uuid, date, date, integer) to authenticated;
revoke execute on function public.create_manual_block(uuid, date, date, text, public.block_reason) from public, anon;
grant execute on function public.create_manual_block(uuid, date, date, text, public.block_reason) to authenticated;
revoke execute on function public.admin_external_calendars(uuid) from public, anon;
grant execute on function public.admin_external_calendars(uuid) to authenticated;
revoke execute on function public.admin_calendar_conflicts(uuid) from public, anon;
grant execute on function public.admin_calendar_conflicts(uuid) to authenticated;
revoke execute on function public.admin_claim_ical_sync(uuid) from public, anon;
grant execute on function public.admin_claim_ical_sync(uuid) to authenticated;
revoke execute on function public.admin_price_calendar(uuid, date, date) from public, anon;
grant execute on function public.admin_price_calendar(uuid, date, date) to authenticated;
