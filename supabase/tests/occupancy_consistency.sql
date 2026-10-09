-- Definición única de "noche ocupada" (Sesión 8): el calendario público
-- (get_property_availability) y el motor de precios (quote_stay) deben decir
-- exactamente lo mismo, noche por noche, para todas las clases de ocupación.
-- Sin datos residuales: BEGIN … ROLLBACK.
--   npx supabase db query --linked -f supabase/tests/occupancy_consistency.sql

begin;

create temp table test_results (
  n        integer generated always as identity,
  caso     text,
  esperado text,
  obtenido text
) on commit drop;

create function pg_temp.rec(p_caso text, p_esperado text, p_obtenido text)
returns void language sql as $$
  insert into test_results (caso, esperado, obtenido) values (p_caso, p_esperado, p_obtenido);
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  d0 date;
  o uuid; grp uuid; p uuid; g uuid; cal uuid; r uuid;
  night date;
  in_calendar boolean;
  in_quote boolean;
  mismatches text := '';
  occupied_calendar int := 0;
  occupied_quote int := 0;
begin
  d0 := hoy + 2;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST', 'TEST-OCC', true) returning id into o;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (o, 'TEST', 40000) returning id into grp;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours)
    values (o, grp, 'test-occ', 'TEST', 'Iquique', 'publicada', 1, 0) returning id into p;
  insert into public.guests (full_name, email) values ('TEST', 'occ@test.invalid') returning id into g;
  insert into public.external_calendars (property_id, channel, import_url) values (p, 'airbnb', 'https://example.invalid/x.ics') returning id into cal;

  -- 1) Reserva confirmada: 3 noches.
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out)
    values (p, g, o, 'confirmada', d0 + 3, d0 + 6);
  -- 2) Hold vigente: 1 noche.
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at)
    values (p, g, o, 'hold', d0 + 7, d0 + 8, now() + interval '20 minutes');
  -- 3) Hold vencido aún sin liberar (el job no corre dentro de esta transacción): 1 noche.
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at)
    values (p, g, o, 'hold', d0 + 10, d0 + 11, now() - interval '1 minute');
  -- 4) Bloqueo manual: 1 noche.
  insert into public.calendar_occupancies (property_id, stay, kind) values (p, daterange(d0 + 13, d0 + 14), 'manual_block');
  -- 5) Bloqueo iCal: 1 noche.
  insert into public.calendar_occupancies (property_id, stay, kind, external_calendar_id, external_uid)
    values (p, daterange(d0 + 16, d0 + 17), 'ical_block', cal, 'evento@test');
  -- 6) Reserva cancelada: NO ocupa.
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out)
    values (p, g, o, 'confirmada', d0 + 19, d0 + 22) returning id into r;
  update public.reservations set status = 'cancelada', cancellation_reason = 'cliente' where id = r;
  -- 7) Hold MANUAL vigente (Sesión 10a, esperando transferencia): 1 noche.
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at, payment_mode)
    values (p, g, o, 'hold', d0 + 24, d0 + 25, now() + interval '12 hours', 'manual');
  -- 8) Hold MANUAL vencido aún sin liberar: 1 noche (lado seguro).
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at, payment_mode)
    values (p, g, o, 'hold', d0 + 26, d0 + 27, now() - interval '1 minute', 'manual');

  for i in 0..29 loop
    night := d0 + i;
    in_calendar := exists (
      select 1 from public.get_property_availability('test-occ', d0, d0 + 30) a
       where night >= a.start_date and night < a.end_date);
    in_quote := (public.quote_stay('test-occ', night, night + 1, 1) ->> 'reason') is not distinct from 'unavailable';
    if in_calendar then occupied_calendar := occupied_calendar + 1; end if;
    if in_quote then occupied_quote := occupied_quote + 1; end if;
    if in_calendar <> in_quote then mismatches := mismatches || night::text || ' '; end if;
  end loop;

  perform pg_temp.rec('Noches donde calendario y motor difieren (30 noches)', 'ninguna', coalesce(nullif(trim(mismatches), ''), 'ninguna'));
  perform pg_temp.rec('Noches ocupadas según el calendario (3+1+1+1+1+1+1)', '9', occupied_calendar::text);
  perform pg_temp.rec('Noches ocupadas según el motor', '9', occupied_quote::text);
  perform pg_temp.rec('Hold manual vigente y vencido ocupan (misma definición)', 'unavailable|unavailable',
    (public.quote_stay('test-occ', d0 + 24, d0 + 25, 1) ->> 'reason') || '|' || (public.quote_stay('test-occ', d0 + 26, d0 + 27, 1) ->> 'reason'));
  perform pg_temp.rec('Hold vigente ocupa', 'true',
    exists (select 1 from public.get_property_availability('test-occ', d0, d0 + 30) a where d0 + 7 >= a.start_date and d0 + 7 < a.end_date)::text);
  perform pg_temp.rec('Hold vencido sin liberar ocupa (lado seguro)', 'unavailable',
    public.quote_stay('test-occ', d0 + 10, d0 + 11, 1) ->> 'reason');
  perform pg_temp.rec('Reserva cancelada no ocupa', 'ok',
    coalesce(public.quote_stay('test-occ', d0 + 19, d0 + 22, 1) ->> 'reason', 'ok'));
  perform pg_temp.rec('occupied_ranges = active_occupancies (misma cantidad)', 'true',
    ((select count(*) from public.occupied_ranges(p)) = (select count(*) from public.active_occupancies(p)))::text);
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
