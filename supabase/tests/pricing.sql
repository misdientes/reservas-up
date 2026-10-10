-- Pruebas del motor de precios (Sesión 7).
-- Corren contra la base remota sin dejar datos: todo dentro de BEGIN … ROLLBACK.
--   npx supabase db query --linked -f supabase/tests/pricing.sql
-- Fechas relativas: M = próximo lunes, al menos 10 días después de hoy
-- (en Chile), para controlar qué noches son de semana y de fin de semana
-- (viernes y sábado por defecto).

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

-- Resumen compacto de una cotización: "total|reason|min_nights".
create function pg_temp.qs(p_quote jsonb) returns text language sql as $$
  select coalesce(p_quote ->> 'total_clp', '-') || '|' || coalesce(p_quote ->> 'reason', 'ok') || '|' || coalesce(p_quote ->> 'min_nights', '-');
$$;

do $$
declare
  hoy     date := (now() at time zone 'America/Santiago')::date;
  m       date;
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc   uuid := gen_random_uuid();
  o_a uuid; o_b uuid; o_c uuid;
  g_a uuid; g_b uuid; g_c uuid;
  p_a uuid; p_b uuid; p_c uuid; p_d uuid; p_e uuid;
  g uuid;
  r_hold uuid;
  v jsonb;
  t int;
  rb int;
  bad int := 0;
begin
  m := hoy + 10 + ((8 - extract(isodow from hoy + 10)::int) % 7);

  -- ─── Datos de prueba ───────────────────────────────────────────────────
  insert into public.owners (kind, legal_name, rut, vat_applies, apply_avaluo_rebate, avaluo_rebate_rate)
    values ('empresa', 'TEST SpA', '90000011-1', true, true, 0.11) returning id into o_a;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('persona_natural', 'TEST IVA pendiente', '90000012-K', null) returning id into o_b;
  insert into public.owners (kind, legal_name, rut, vat_applies) values ('persona_natural', 'TEST exento', '90000013-8', false) returning id into o_c;

  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, dow_gross_clp, cleaning_fee_gross_clp, included_guests, extra_guest_gross_clp)
    values (o_a, 'TEST A', 40000, '{null,null,null,null,45000,45000,null}', 6000, 2, 10000) returning id into g_a;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp)
    values (o_b, 'TEST B', 35000, 6000) returning id into g_b;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp)
    values (o_c, 'TEST C', 50000, 0) returning id into g_c;
  -- Temporada de A: noches de M+7 (lunes) a M+13 (domingo), mínimo 3.
  insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, dow_gross_clp, min_nights)
    values (g_a, 'Verano', daterange(m + 7, m + 14), 55000, '{null,null,null,null,60000,60000,null}', 3);
  -- Temporada de C más barata que su base, dentro de los próximos 90 días.
  insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp)
    values (g_c, 'Baja', daterange(hoy + 30, hoy + 40), 30000);

  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, max_guests, min_nights, min_advance_hours, check_in_time, avaluo_fiscal_clp)
    values (o_a, g_a, 'tp-a', 'TP A', 'Iquique', 'publicada', 4, 2, 24, '15:00', 60000000) returning id into p_a;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, max_guests, min_nights, min_advance_hours, check_in_time)
    values (o_b, g_b, 'tp-b', 'TP B', 'Santiago', 'publicada', 2, 1, 24, null) returning id into p_b;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours)
    values (o_c, g_c, 'tp-c', 'TP C', 'Iquique', 'publicada', 1, 0) returning id into p_c;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status)
    values (o_a, g_a, 'tp-d', 'TP D borrador', 'Iquique', 'borrador') returning id into p_d;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours)
    values (o_a, g_a, 'tp-e', 'TP E', 'Iquique', 'publicada', 5, 0) returning id into p_e;

  -- ─── Tarifas por tipo de noche ─────────────────────────────────────────
  v := public.quote_stay('tp-a', m, m + 3, 2);
  perform pg_temp.rec('Solo entre semana (lu-mi): 3×40.000 + aseo', '126000|ok|2', pg_temp.qs(v));
  perform pg_temp.rec('  noches de tipo base', 'base,base,base',
    (select string_agg(n ->> 'kind', ',' order by n ->> 'date') from jsonb_array_elements(v -> 'nights') n));
  v := public.quote_stay('tp-a', m + 4, m + 6, 2);
  perform pg_temp.rec('Solo fin de semana (vi-sá): 2×45.000 + aseo', '96000|ok|2', pg_temp.qs(v));
  v := public.quote_stay('tp-a', m + 2, m + 6, 2);
  perform pg_temp.rec('Mixta (mi-sá): 2×40.000 + 2×45.000 + aseo', '176000|ok|2', pg_temp.qs(v));
  perform pg_temp.rec('  tipos de noche', 'base,base,dow,dow',
    (select string_agg(n ->> 'kind', ',' order by n ->> 'date') from jsonb_array_elements(v -> 'nights') n));

  -- ─── Temporadas ────────────────────────────────────────────────────────
  v := public.quote_stay('tp-a', m + 5, m + 9, 2);
  perform pg_temp.rec('Temporada empieza a mitad (sá,do | lu,ma): 45+40+55+55 mil + aseo', '201000|ok|2', pg_temp.qs(v));
  perform pg_temp.rec('  tipos de noche', 'dow,base,season,season',
    (select string_agg(n ->> 'kind', ',' order by n ->> 'date') from jsonb_array_elements(v -> 'nights') n));
  v := public.quote_stay('tp-a', m + 11, m + 15, 2);
  perform pg_temp.rec('Temporada termina a mitad (vi,sá,do de temporada | lu): 60+60+55+40 mil + aseo', '221000|ok|3', pg_temp.qs(v));
  perform pg_temp.rec('  tipos de noche y temporada', 'season_dow:Verano,season_dow:Verano,season:Verano,base:',
    (select string_agg((n ->> 'kind') || ':' || coalesce(n ->> 'season', ''), ',' order by n ->> 'date') from jsonb_array_elements(v -> 'nights') n));

  -- ─── Mínimo de noches: el mayor de propiedad y temporada ───────────────
  perform pg_temp.rec('Llegada en temporada (mín. 3) con 2 noches', '-|min_nights|3', pg_temp.qs(public.quote_stay('tp-a', m + 7, m + 9, 2)));
  perform pg_temp.rec('Llegada fuera de temporada (propiedad mín. 2) con 1 noche', '-|min_nights|2', pg_temp.qs(public.quote_stay('tp-a', m, m + 1, 2)));
  perform pg_temp.rec('Propiedad mín. 5 > temporada mín. 3, llegada en temporada con 4 noches', '-|min_nights|5', pg_temp.qs(public.quote_stay('tp-e', m + 7, m + 11, 2)));
  perform pg_temp.rec('Llegada en temporada con 3 noches (cumple)', '171000|ok|3', pg_temp.qs(public.quote_stay('tp-a', m + 7, m + 10, 2)));

  -- ─── Huéspedes ─────────────────────────────────────────────────────────
  perform pg_temp.rec('4 huéspedes (2 extra × 10.000 × 3 noches)', '186000|ok|2', pg_temp.qs(public.quote_stay('tp-a', m, m + 3, 4)));
  perform pg_temp.rec('5 huéspedes con máximo 4', '-|max_guests|-', pg_temp.qs(public.quote_stay('tp-a', m, m + 3, 5)));
  perform pg_temp.rec('0 huéspedes', '-|max_guests|-', pg_temp.qs(public.quote_stay('tp-a', m, m + 3, 0)));

  -- ─── Fechas inválidas ──────────────────────────────────────────────────
  perform pg_temp.rec('Salida antes de llegada', '-|invalid_dates|-', pg_temp.qs(public.quote_stay('tp-a', m + 3, m, 2)));
  perform pg_temp.rec('Llegada en el pasado', '-|invalid_dates|-', pg_temp.qs(public.quote_stay('tp-a', hoy - 1, hoy + 2, 2)));
  perform pg_temp.rec('Salida más allá de 548 días', '-|invalid_dates|-', pg_temp.qs(public.quote_stay('tp-c', hoy + 547, hoy + 549, 1)));
  perform pg_temp.rec('Última noche de la ventana (sale hoy+548)', 'ok', coalesce(public.quote_stay('tp-c', hoy + 547, hoy + 548, 1) ->> 'reason', 'ok'));

  -- ─── Anticipación mínima: borde exacto (misma regla que el frontend) ──
  -- 24 h antes de las 15:00 de la llegada (hora de Chile): alcanza.
  perform pg_temp.rec('Anticipación 24 h: justo a las 15:00 del día anterior', 'ok',
    coalesce(public.pricing_core(p_a, m, m + 3, 2, null, ((m - 1) + time '15:00') at time zone 'America/Santiago') ->> 'reason', 'ok'));
  perform pg_temp.rec('Anticipación 24 h: un minuto después', 'advance',
    public.pricing_core(p_a, m, m + 3, 2, null, ((m - 1) + time '15:01') at time zone 'America/Santiago') ->> 'reason');
  perform pg_temp.rec('  y la llegada más temprana es el día siguiente', (m + 1)::text,
    public.pricing_core(p_a, m, m + 3, 2, null, ((m - 1) + time '15:01') at time zone 'America/Santiago') ->> 'earliest_check_in');
  perform pg_temp.rec('Sin hora de check-in (= 00:00): 24 h exactas', 'ok',
    coalesce(public.pricing_core(p_b, m, m + 2, 1, null, ((m - 1) + time '00:00') at time zone 'America/Santiago') ->> 'reason', 'ok'));
  perform pg_temp.rec('Sin hora de check-in: un minuto después', 'advance',
    public.pricing_core(p_b, m, m + 2, 1, null, ((m - 1) + time '00:01') at time zone 'America/Santiago') ->> 'reason');
  perform pg_temp.rec('Anticipación se evalúa después de invalid_dates', 'invalid_dates',
    public.pricing_core(p_a, m + 3, m, 2, null, ((m - 1) + time '15:01') at time zone 'America/Santiago') ->> 'reason');

  -- ─── Disponibilidad ────────────────────────────────────────────────────
  insert into public.calendar_occupancies (property_id, stay, kind) values (p_a, daterange(m + 1, m + 2), 'manual_block');
  perform pg_temp.rec('Noche ocupada dentro de la estadía', '-|unavailable|2', pg_temp.qs(public.quote_stay('tp-a', m, m + 3, 2)));
  perform pg_temp.rec('Salir el día en que empieza una ocupación', '86000|ok|2', pg_temp.qs(public.quote_stay('tp-a', m - 1 + 0, m + 1, 2)));

  -- Reserva propia: el checkout (Sesión 9) ignora el hold de su reserva.
  insert into public.guests (full_name, email) values ('TEST', 'pricing@test.invalid') returning id into g;
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at)
    values (p_a, g, o_a, 'hold', m + 20, m + 23, now() + interval '20 minutes') returning id into r_hold;
  perform pg_temp.rec('Hold activo de la reserva X: pricing_core(…, X) cotiza', 'ok',
    coalesce(public.pricing_core(p_a, m + 20, m + 23, 2, r_hold) ->> 'reason', 'ok'));
  perform pg_temp.rec('Hold activo de la reserva X: pricing_core(…, null) no', 'unavailable',
    public.pricing_core(p_a, m + 20, m + 23, 2, null) ->> 'reason');
  -- Regresión (Sesión 7): los bloqueos manuales/iCal no tienen reservation_id;
  -- excluir una reserva NO debe hacer que se ignoren.
  perform pg_temp.rec('Excluir la reserva X no ignora un bloqueo manual', 'unavailable',
    public.pricing_core(p_a, m, m + 3, 2, r_hold) ->> 'reason');
  perform pg_temp.rec('quote_stay pública: el hold bloquea', 'unavailable',
    public.quote_stay('tp-a', m + 20, m + 23, 2) ->> 'reason');

  -- ─── Visibilidad y claves públicas ─────────────────────────────────────
  perform pg_temp.rec('Propiedad en borrador', 'not_found', public.quote_stay('tp-d', m, m + 3, 2) ->> 'reason');
  perform pg_temp.rec('Slug inexistente', 'not_found', public.quote_stay('no-existe', m, m + 3, 2) ->> 'reason');
  v := public.quote_stay('tp-a', m + 14, m + 17, 2);
  perform pg_temp.rec('quote_stay solo trae claves públicas (sin neto/IVA/avalúo)',
    'cleaning_clp,extra_guests,extra_guests_clp,min_nights,nights,nights_count,quotable,total_clp',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v) k));

  -- ─── IVA pendiente y exento: Santiago se cotiza igual ──────────────────
  perform pg_temp.rec('Owner con IVA pendiente (Santiago): SÍ cotiza', '76000|ok|1', pg_temp.qs(public.quote_stay('tp-b', m, m + 2, 1)));
  perform pg_temp.rec('Owner exento: cotiza', '150000|ok|1', pg_temp.qs(public.quote_stay('tp-c', m, m + 3, 1)));

  -- ─── Extracción de neto e IVA: neto + IVA = total en 20 combinaciones ──
  foreach t in array array[40000, 45000, 35000, 6000, 15000, 10000, 126000, 86000, 85999, 1, 0, 119, 999999, 201000, 206000, 40001, 39999, 7, 33613, 5000000] loop
    foreach rb in array array[0, 54247] loop
      if (select net_clp + vat_clp <> t or vat_clp < 0 or net_clp > t from public.vat_extract(t, rb)) then
        bad := bad + 1;
      end if;
    end loop;
  end loop;
  perform pg_temp.rec('neto + IVA = total y IVA ≥ 0 en 20 totales × 2 rebajas', '0 fallas', bad || ' fallas');
  perform pg_temp.rec('$40.000 sin rebaja: neto 33.613 + IVA 6.387', '33613+6387',
    (select net_clp || '+' || vat_clp from public.vat_extract(40000, 0)));
  perform pg_temp.rec('Exento/tope: rebaja mayor que el total → IVA 0', '1000+0',
    (select net_clp || '+' || vat_clp from public.vat_extract(1000, 999999)));

  -- ─── Desglose interno (solo admin) ─────────────────────────────────────
  perform pg_temp.as_role('authenticated', v_admin);
  v := public.internal_tax_breakdown(p_a, m + 14, m + 17, 2); -- lu-mi fuera de temporada
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Admin: total interno = total público', '126000', v ->> 'total_clp');
  perform pg_temp.rec('Admin: rebaja (60 M × 0,11 / 365 × 3 noches)', '54247', v ->> 'avaluo_rebate_base_clp');
  perform pg_temp.rec('Admin: neto + IVA con rebaja', '114544+11456', (v ->> 'net_clp') || '+' || (v ->> 'vat_clp'));
  perform pg_temp.rec('Admin: IVA con rebaja < IVA sin rebaja (20.118)', 'true',
    ((v ->> 'vat_clp')::int < (select vat_clp from public.vat_extract(126000, 0)))::text);
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Admin: IVA pendiente → tax_status pending, sin cifras', 'pending|null',
    (select (x ->> 'tax_status') || '|' || coalesce(x ->> 'vat_clp', 'null') from (select public.internal_tax_breakdown(p_b, m, m + 2, 1) x) s));
  perform pg_temp.rec('Admin: exento → IVA 0, neto = total', 'exempt|150000|0',
    (select (x ->> 'tax_status') || '|' || (x ->> 'net_clp') || '|' || (x ->> 'vat_clp') from (select public.internal_tax_breakdown(p_c, m, m + 3, 1) x) s));
  perform pg_temp.rec('Admin: propiedad en borrador también (boletas)', '126000',
    public.internal_tax_breakdown(p_d, m, m + 3, 2) ->> 'total_clp');
  perform pg_temp.as_postgres();

  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-pricing@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST');
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: internal_tax_breakdown', 'denegado',
    pg_temp.q(format($s$select public.internal_tax_breakdown(%L, %L, %L, 2)::text$s$, p_a, m, m + 3)));
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: internal_tax_breakdown', 'denegado',
    pg_temp.q(format($s$select public.internal_tax_breakdown(%L, %L, %L, 2)::text$s$, p_a, m, m + 3)));
  perform pg_temp.rec('Anon: pricing_core (interno)', 'denegado',
    pg_temp.q(format($s$select public.pricing_core(%L, %L, %L, 2)::text$s$, p_a, m, m + 3)));
  perform pg_temp.rec('Anon: vat_extract (interno)', 'denegado', pg_temp.q($s$select net_clp::text from public.vat_extract(40000, 0)$s$));
  perform pg_temp.rec('Anon: quote_stay', '126000', pg_temp.q(format($s$select public.quote_stay('tp-a', %L, %L, 2) ->> 'total_clp'$s$, m + 14, m + 17)));
  perform pg_temp.rec('Anon: public_price_from', '40000', pg_temp.q($s$select public.public_price_from('tp-a')::text$s$));
  perform pg_temp.rec('Anon: price_from_clp en la vista pública', '40000',
    pg_temp.q($s$select price_from_clp::text from public.public_properties where slug = 'tp-a'$s$));
  perform pg_temp.as_postgres();

  -- ─── Precio "desde" ────────────────────────────────────────────────────
  perform pg_temp.rec('"Desde" con temporada más cara (= base)', '40000', public.public_price_from('tp-a')::text);
  perform pg_temp.rec('"Desde" con temporada más barata en los próximos 90 días', '30000', public.public_price_from('tp-c')::text);
  perform pg_temp.rec('"Desde" sin temporada', '35000', public.public_price_from('tp-b')::text);
  perform pg_temp.rec('"Desde" de un borrador', 'null', coalesce(public.public_price_from('tp-d')::text, 'null'));
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
