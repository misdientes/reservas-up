-- Panel de tarifas, temporadas, descuentos, bloqueos e iCal (Sesión 13):
-- permisos; precio por día; prioridad de temporadas; noches mínimas
-- (temporada > tarifa, propiedad como piso); descuentos por estadía larga
-- dentro de pricing_core (y neto + IVA = total); límites; fechas relativas a
-- hoy en triggers; bloqueos con motivo y choque explicado; reservas
-- existentes intactas al cambiar precios; URLs iCal validadas y
-- enmascaradas; "sincronizar ahora" con pausa; calendario del panel;
-- simulador = cotización pública; historial sin valores; publish_property
-- sigue exigiendo 90 noches con precio.
-- Corre en local y en producción sin dejar datos: BEGIN … ROLLBACK.
--   producción:  npx supabase db query --linked -f supabase/tests/rates_calendar.sql
--   local:       ver supabase/tests/README.md (psql dentro del contenedor)

begin;

-- Los holds solo se toman en modo 'online' (producción está en 'whatsapp'):
-- se activa aquí, dentro de la transacción que termina en ROLLBACK.
update public.app_settings set value = 'online' where key = 'booking_mode';
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

-- Igual que q, pero devuelve el MENSAJE del error (para los textos claros).
create function pg_temp.msg(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return 'sin error: ' || coalesce(v, 'null');
exception
  when others then return sqlerrm;
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

-- Precios de las noches de una cotización: "kind:precio,…".
create function pg_temp.np(p_quote jsonb) returns text language sql as $$
  select string_agg((n ->> 'kind') || ':' || (n ->> 'price_clp'), ',' order by n ->> 'date')
    from jsonb_array_elements(p_quote -> 'nights') n;
$$;

-- Hold manual como lo haría create-booking (con el total del motor).
create function pg_temp.mhold(p_slug text, p_email text, p_in date, p_out date)
returns jsonb language sql as $$
  select public.create_booking_hold(p_slug, p_in, p_out, 2, 'TEST', p_email, '+56911111111', 'Chile',
           '{"requested": false}'::jsonb, null,
           (public.pricing_core((select id from public.properties where slug = p_slug), p_in, p_out, 2) ->> 'total_clp')::int,
           'bank_transfer', 'deposit');
$$;

do $$
declare
  hoy date := (now() at time zone 'America/Santiago')::date;
  m date;   -- lunes, al menos 20 días adelante
  d date;   -- llegadas de las reservas de prueba
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  u_enc uuid := gen_random_uuid();
  o uuid; acc uuid;
  g uuid; g2 uuid; g3 uuid;
  p uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
  s_old uuid;
  cal uuid;
  blk uuid;
  r_hold uuid; r_conf uuid;
  hold_total integer; hold_deposit integer; conf_total integer; conf_net integer; conf_vat integer;
  ts timestamptz;
  v jsonb;
  -- DDL solo en la base local (app_settings.environment = 'local'; la pone seed.sql).
  v_local boolean := coalesce((select value from public.app_settings where key = 'environment'), '') = 'local';
begin
  m := hoy + 20 + ((8 - extract(isodow from hoy + 20)::integer) % 7);
  d := hoy + 60;

  insert into auth.users (id, instance_id, aud, role, email)
    values (u_enc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enc-tarifas@test.invalid');
  insert into public.app_users (id, role, full_name) values (u_enc, 'encargado', 'TEST Encargado Tarifas');

  insert into public.owners (kind, legal_name, rut, vat_applies) values ('empresa', 'TEST Tarifas', '90000019-7', true) returning id into o;
  insert into public.payment_accounts (owner_id, label, bank_name, account_type, account_number, holder_name, holder_rut, holder_email)
    values (o, 'TEST', 'Banco TEST', 'Cuenta corriente', 'TEST-000777', 'TEST', '90000019-7', 't@test.invalid') returning id into acc;

  -- G: viernes 45.000 y sábado 50.000 (distintos), mínimo de la tarifa 4.
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, dow_gross_clp, cleaning_fee_gross_clp, min_nights)
    values (o, 'TEST G', 40000, '{null,null,null,null,45000,50000,null}', 6000, 4) returning id into g;
  -- Verano (Normal) cubre 4 semanas; "Año Nuevo" (Máxima) 2 noches dentro.
  insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, dow_gross_clp, min_nights, priority)
    values (g, 'Verano', daterange(m, m + 28), 55000, '{null,null,null,null,null,60000,null}', 3, 1);
  insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, min_nights, priority)
    values (g, 'Año Nuevo', daterange(m + 7, m + 9), 90000, 2, 3);
  -- G2: sin temporadas ni descuentos. G3: con descuentos 7+ (10 %) y 28+ (20 %).
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, dow_gross_clp, cleaning_fee_gross_clp)
    values (o, 'TEST G2', 40000, '{null,null,null,null,45000,50000,null}', 6000) returning id into g2;
  insert into public.rate_groups (owner_id, name, base_nightly_gross_clp, cleaning_fee_gross_clp, included_guests, extra_guest_gross_clp)
    values (o, 'TEST G3', 40000, 6000, 2, 10000) returning id into g3;
  insert into public.rate_long_stay_discounts (rate_group_id, min_nights, percent) values (g3, 7, 10), (g3, 28, 20);

  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, check_in_time, payment_account_id)
    values (o, g, 'test-rt-g', 'TEST RT G', 'Iquique', 'publicada', 1, 0, 4, '15:00', acc) returning id into p;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, check_in_time, payment_account_id)
    values (o, g2, 'test-rt-g2', 'TEST RT G2', 'Iquique', 'publicada', 1, 0, 4, '15:00', acc) returning id into p2;
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests, check_in_time, payment_account_id)
    values (o, g3, 'test-rt-g3', 'TEST RT G3', 'Iquique', 'publicada', 1, 0, 4, '15:00', acc) returning id into p3;
  -- Misma tarifa G, pero la propiedad exige 5 noches (piso).
  insert into public.properties (owner_id, rate_group_id, slug, name, city, status, min_nights, min_advance_hours, max_guests)
    values (o, g, 'test-rt-piso', 'TEST RT piso', 'Iquique', 'publicada', 5, 0, 4) returning id into p4;
  -- En borrador (para el simulador y "sin calendarios").
  insert into public.properties (owner_id, rate_group_id, slug, name, city, min_nights, min_advance_hours, max_guests)
    values (o, g3, 'test-rt-draft', 'TEST RT borrador', 'Iquique', 1, 0, 4) returning id into p5;

  -- ═══ 1. Precio por día de la semana ══════════════════════════════════
  v := public.quote_stay('test-rt-g2', m, m + 7, 2);
  perform pg_temp.rec('Semana sin temporada: lun-jue base, vie 45.000, sáb 50.000, dom base',
    'base:40000,base:40000,base:40000,base:40000,dow:45000,dow:50000,base:40000', pg_temp.np(v));
  perform pg_temp.rec('Total de la semana (7 noches + aseo, sin descuentos en G2)', '301000', v ->> 'total_clp');

  -- ═══ 2. Temporadas con prioridad ═════════════════════════════════════
  v := public.pricing_core(p, m + 4, m + 10, 2);
  perform pg_temp.rec('Vie y sáb en Verano; lun-mar Año Nuevo (Máxima) manda sobre Verano',
    'season:55000,season_dow:60000,season:55000,season:90000,season:90000,season:55000', pg_temp.np(v));
  perform pg_temp.rec('Nombre de la temporada ganadora en la noche de Año Nuevo', 'Año Nuevo',
    (select n ->> 'season' from jsonb_array_elements(v -> 'nights') n where (n ->> 'date')::date = m + 7));
  perform pg_temp.rec('Misma prioridad cruzada → rechazada por la base', '23P01',
    pg_temp.q(format($s$with x as (insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, priority) values (%L, 'Choque', daterange(%L::date + 20, %L::date + 40), 50000, 1) returning 1) select count(*)::text from x$s$, g, m, m)));
  perform pg_temp.rec('Distinta prioridad cruzada → permitida', '1',
    pg_temp.q(format($s$with x as (insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, priority) values (%L, 'Fin de mes', daterange(%L::date + 20, %L::date + 22), 70000, 2) returning 1) select count(*)::text from x$s$, g, m, m)));
  perform pg_temp.rec('Alta (2) manda sobre Normal (1)', 'season:70000:Fin de mes',
    (select kind || ':' || price_clp || ':' || season_name from public.night_price(g, m + 20)));

  -- ═══ 3. Noches mínimas ═══════════════════════════════════════════════
  perform pg_temp.rec('Llegada fuera de temporada: mínimo de la tarifa (4)', 'min_nights|4',
    (select (x ->> 'reason') || '|' || (x ->> 'min_nights') from (select public.quote_stay('test-rt-g', m + 30, m + 32, 2) x) s));
  perform pg_temp.rec('Llegada en Verano: el mínimo de la temporada (3) reemplaza al de la tarifa', 'true|3',
    (select (x ->> 'quotable') || '|' || (x ->> 'min_nights') from (select public.quote_stay('test-rt-g', m, m + 3, 2) x) s));
  perform pg_temp.rec('Llegada en Año Nuevo: manda el mínimo de la temporada ganadora (2)', 'true|2',
    (select (x ->> 'quotable') || '|' || (x ->> 'min_nights') from (select public.quote_stay('test-rt-g', m + 7, m + 9, 2) x) s));
  perform pg_temp.rec('La propiedad es un piso: exige 5 aunque la temporada pida 3', 'min_nights|5',
    (select (x ->> 'reason') || '|' || (x ->> 'min_nights') from (select public.quote_stay('test-rt-piso', m, m + 4, 2) x) s));

  -- ═══ 4. Descuentos por estadía larga (dentro de pricing_core) ═════════
  v := public.quote_stay('test-rt-g3', d, d + 6, 2);
  perform pg_temp.rec('6 noches: sin descuento (y sin las claves del descuento)', '246000|false',
    (v ->> 'total_clp') || '|' || (v ? 'long_stay_discount_clp')::text);
  v := public.quote_stay('test-rt-g3', d, d + 7, 2);
  perform pg_temp.rec('7 noches (borde): −10 % de 280.000 = 28.000; aseo sin descuento', '10|28000|258000',
    (v ->> 'long_stay_discount_percent') || '|' || (v ->> 'long_stay_discount_clp') || '|' || (v ->> 'total_clp'));
  v := public.quote_stay('test-rt-g3', d, d + 7, 3);
  perform pg_temp.rec('7 noches, 3 huéspedes: descuento sobre noches + extra (350.000)', '35000|321000',
    (v ->> 'long_stay_discount_clp') || '|' || (v ->> 'total_clp'));
  v := public.quote_stay('test-rt-g3', d, d + 27, 2);
  perform pg_temp.rec('27 noches: todavía el 10 %', '10|978000', (v ->> 'long_stay_discount_percent') || '|' || (v ->> 'total_clp'));
  v := public.quote_stay('test-rt-g3', d, d + 28, 2);
  perform pg_temp.rec('28 noches: un solo tramo, el mayor (20 %)', '20|224000|902000',
    (v ->> 'long_stay_discount_percent') || '|' || (v ->> 'long_stay_discount_clp') || '|' || (v ->> 'total_clp'));
  perform pg_temp.rec('Desglose público sin palabras tributarias', '0',
    (select count(*)::text from jsonb_object_keys(v) k where k ~* '(net|vat|iva|tax|impuesto|rebate)'));
  perform pg_temp.rec('Total de quote_stay = total de pricing_core (una sola fuente)', 'true',
    ((v ->> 'total_clp') = (public.pricing_core(p3, d, d + 28, 2) ->> 'total_clp'))::text);
  perform pg_temp.as_role('authenticated', v_admin);
  v := public.internal_tax_breakdown(p3, d, d + 7, 3);
  perform pg_temp.rec('Con descuento: desglose interno cuadra (neto + IVA = total)', '321000|true',
    (v ->> 'total_clp') || '|' || (((v ->> 'net_clp')::int + (v ->> 'vat_clp')::int) = (v ->> 'total_clp')::int)::text);
  v := public.internal_tax_breakdown(p3, d, d + 6, 2);
  perform pg_temp.rec('Sin descuento: desglose interno cuadra', '246000|true',
    (v ->> 'total_clp') || '|' || (((v ->> 'net_clp')::int + (v ->> 'vat_clp')::int) = (v ->> 'total_clp')::int)::text);
  perform pg_temp.as_postgres();

  -- ═══ 5. Límites (validación en el servidor) ══════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Precio base 0 → rechazado', '23514',
    pg_temp.q(format($s$with x as (insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (%L, 'TEST cero', 0) returning 1) select count(*)::text from x$s$, o)));
  perform pg_temp.rec('Precio base sobre el máximo → rechazado', '23514',
    pg_temp.q(format($s$with x as (insert into public.rate_groups (owner_id, name, base_nightly_gross_clp) values (%L, 'TEST caro', 5000001) returning 1) select count(*)::text from x$s$, o)));
  perform pg_temp.rec('Precio por día con 6 posiciones → rechazado', '23514',
    pg_temp.q(format($s$update public.rate_groups set dow_gross_clp = '{1000,1000,1000,1000,1000,1000}' where id = %L returning 'x'$s$, g2)));
  perform pg_temp.rec('Precio por día de $500 → rechazado', '23514',
    pg_temp.q(format($s$update public.rate_groups set dow_gross_clp = '{null,null,null,null,500,null,null}' where id = %L returning 'x'$s$, g2)));
  perform pg_temp.rec('Noches mínimas 61 → rechazado', '23514',
    pg_temp.q(format($s$update public.rate_groups set min_nights = 61 where id = %L returning 'x'$s$, g2)));
  perform pg_temp.rec('Descuento del 61 % → rechazado', '23514',
    pg_temp.q(format($s$with x as (insert into public.rate_long_stay_discounts (rate_group_id, min_nights, percent) values (%L, 14, 61) returning 1) select count(*)::text from x$s$, g3)));
  perform pg_temp.rec('Dos tramos con las mismas noches → rechazado', '23505',
    pg_temp.q(format($s$with x as (insert into public.rate_long_stay_discounts (rate_group_id, min_nights, percent) values (%L, 7, 5) returning 1) select count(*)::text from x$s$, g3)));
  perform pg_temp.rec('Prioridad 4 → rechazada', '23514',
    pg_temp.q(format($s$with x as (insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, priority) values (%L, 'X prio', daterange(%L::date + 100, %L::date + 101), 50000, 4) returning 1) select count(*)::text from x$s$, g2, m, m)));
  perform pg_temp.rec('Temporada de más de 370 noches → rechazada', '23514',
    pg_temp.q(format($s$with x as (insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp) values (%L, 'X larga', daterange(%L::date, %L::date + 371), 50000) returning 1) select count(*)::text from x$s$, g2, hoy, hoy)));
  perform pg_temp.as_postgres();

  -- ═══ 6. Fechas relativas a hoy: trigger, no CHECK ════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Temporada que ya terminó → rechazada con mensaje', 'La temporada ya terminó: elige fechas desde hoy en adelante.',
    pg_temp.msg(format($s$insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp) values (%L, 'Pasada', daterange(%L::date - 10, %L::date - 2), 50000) returning 'x'$s$, g2, hoy, hoy)));
  perform pg_temp.rec('Temporada que termina después de 2 años → rechazada', 'La temporada debe terminar dentro de los próximos 2 años.',
    pg_temp.msg(format($s$insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp) values (%L, 'Lejana', daterange(%L::date + 700, %L::date + 740), 50000) returning 'x'$s$, g2, hoy, hoy)));
  perform pg_temp.rec('Temporada cuya última noche es hoy + 2 años → permitida', '1',
    pg_temp.q(format($s$with x as (insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp) values (%L, 'Borde', daterange((%L::date + interval '2 years')::date - 5, (%L::date + interval '2 years')::date + 1), 50000) returning 1) select count(*)::text from x$s$, g2, hoy, hoy)));
  perform pg_temp.as_postgres();
  -- Una temporada YA TERMINADA solo se puede fabricar saltando el trigger
  -- (DDL). Decisión de René: ninguna suite ejecuta DDL en producción, así que
  -- esto corre SOLO en la base local; en producción se usa una temporada
  -- vigente (mismo camino del trigger: fechas sin cambios → no se revisan).
  if v_local then
    execute 'alter table public.rate_seasons disable trigger rate_seasons_dates_guard';
    insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp) values (g2, 'Antigua', daterange(hoy - 30, hoy - 20), 50000) returning id into s_old;
    execute 'alter table public.rate_seasons enable trigger rate_seasons_dates_guard';
  else
    select id into s_old from public.rate_seasons where rate_group_id = g2 and name = 'Borde';
  end if;
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec(case when v_local then 'Editar nombre y precio de una temporada pasada (mismas fechas) → permitido'
                           else 'Editar nombre y precio sin mover las fechas (dates = dates) → permitido [producción: sin DDL]' end, 'x',
    pg_temp.q(format($s$update public.rate_seasons set name = 'Antigua 2', nightly_gross_clp = 51000, dates = dates where id = %L returning 'x'$s$, s_old)));
  perform pg_temp.rec('Mover sus fechas al pasado → rechazado', 'P0001',
    pg_temp.q(format($s$update public.rate_seasons set dates = daterange(%L::date - 40, %L::date - 30) where id = %L returning 'x'$s$, hoy, hoy, s_old)));
  perform pg_temp.rec('Ningún CHECK usa now()/current_date en las tablas de Sesión 13', '0',
    (select count(*)::text from pg_constraint c
      where c.conrelid in ('public.rate_groups'::regclass, 'public.rate_seasons'::regclass, 'public.rate_long_stay_discounts'::regclass,
                           'public.calendar_occupancies'::regclass, 'public.external_calendars'::regclass)
        and c.contype = 'c' and pg_get_constraintdef(c.oid) ~* '(now\(\)|current_date|current_timestamp)'));
  perform pg_temp.as_postgres();

  -- ═══ 7. Reservas existentes intactas al cambiar precios ══════════════
  v := pg_temp.mhold('test-rt-g3', 'rt-hold@test.invalid', d, d + 7);
  r_hold := (v ->> 'reservation_id')::uuid;
  v := pg_temp.mhold('test-rt-g3', 'rt-conf@test.invalid', d + 10, d + 12);
  r_conf := (v ->> 'reservation_id')::uuid;
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r_conf, 'bank_transfer', 86000, 'TEST-RT-1');
  perform pg_temp.as_postgres();
  select total_clp, deposit_required_clp into hold_total, hold_deposit from public.reservations where id = r_hold;
  select total_clp, net_total_clp, vat_clp into conf_total, conf_net, conf_vat from public.reservations where id = r_conf;
  perform pg_temp.rec('Hold de 7 noches con descuento y reserva confirmada creadas', '258000|hold|86000|confirmada',
    hold_total || '|' || (select status::text from public.reservations where id = r_hold) || '|' || conf_total || '|' ||
    (select status::text from public.reservations where id = r_conf));

  -- El admin cambia todo: base, temporada Máxima sobre esas fechas, borra descuentos.
  perform pg_temp.as_role('authenticated', v_admin);
  update public.rate_groups set base_nightly_gross_clp = 60000, cleaning_fee_gross_clp = 9000, updated_at = (select updated_at from public.rate_groups where id = g3) where id = g3;
  insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp, priority) values (g3, 'Cara', daterange(d, d + 15), 99000, 3);
  delete from public.rate_long_stay_discounts where rate_group_id = g3;
  perform pg_temp.as_postgres();
  perform pg_temp.rec('La tarifa sí cambió para cotizaciones nuevas', '702000',
    public.pricing_core(p3, d, d + 7, 2, r_hold) ->> 'total_clp');
  perform pg_temp.rec('Hold: total y abono intactos', hold_total || '|' || hold_deposit,
    (select total_clp || '|' || deposit_required_clp from public.reservations where id = r_hold));
  perform pg_temp.rec('Confirmada: total, neto e IVA congelados intactos', conf_total || '|' || conf_net || '|' || conf_vat,
    (select total_clp || '|' || net_total_clp || '|' || vat_clp from public.reservations where id = r_conf));
  perform pg_temp.as_role('authenticated', v_admin);
  perform public.register_manual_payment(r_hold, 'bank_transfer', hold_total, 'TEST-RT-2');
  perform pg_temp.rec('El hold se paga con su total ORIGINAL y se confirma', 'confirmada|258000',
    (select status::text || '|' || amount_paid from public.reservations where id = r_hold));
  perform pg_temp.as_postgres();

  -- ═══ 8. Bloqueos manuales ════════════════════════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Bloqueo sobre una reserva confirmada → mensaje claro', 'true',
    (pg_temp.msg(format($s$select public.create_manual_block(%L, %L::date + 11, %L::date + 13, 'x', 'mantencion')::text$s$, p3, d, d))
      like 'Esas fechas chocan con una reserva (del %')::text);
  perform pg_temp.as_postgres();
  v := pg_temp.mhold('test-rt-g2', 'rt-hold2@test.invalid', d, d + 2);
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Bloqueo sobre un hold → mensaje claro', 'true',
    (pg_temp.msg(format($s$select public.create_manual_block(%L, %L::date + 1, %L::date + 3, null, 'otro')::text$s$, p2, d, d))
      like 'Esas fechas chocan con una reserva en proceso de pago (del %')::text);
  blk := public.create_manual_block(p3, d + 20, d + 23, 'Pintura', 'mantencion');
  perform pg_temp.rec('Bloqueo en fechas libres con motivo y nota', 'mantencion|Pintura|active',
    (select block_reason || '|' || note || '|' || status from public.calendar_occupancies where id = blk));
  perform pg_temp.rec('Bloqueo encima de otro bloqueo → rechazado', 'true',
    (pg_temp.msg(format($s$select public.create_manual_block(%L, %L::date + 22, %L::date + 24, null, 'uso_dueno')::text$s$, p3, d, d)) like '%otro bloqueo%')::text);
  perform pg_temp.rec('El bloqueo ocupa: nadie cotiza esas noches', 'unavailable',
    public.quote_stay('test-rt-g3', d + 20, d + 22, 2) ->> 'reason');
  perform pg_temp.rec('Bloqueo que empieza en el pasado → rechazado', 'Un bloqueo no puede empezar en el pasado.',
    pg_temp.msg(format($s$select public.create_manual_block(%L, %L::date - 1, %L::date + 1, null, 'otro')::text$s$, p3, hoy, hoy)));
  perform pg_temp.rec('Bloqueo de más de 366 noches → rechazado', 'Un bloqueo puede durar como máximo 366 noches.',
    pg_temp.msg(format($s$select public.create_manual_block(%L, %L::date + 100, %L::date + 467, null, 'otro')::text$s$, p3, hoy, hoy)));
  perform pg_temp.rec('Fechas al revés → rechazado', 'La fecha de término debe ser posterior a la de inicio.',
    pg_temp.msg(format($s$select public.create_manual_block(%L, %L::date + 5, %L::date + 5, null, 'otro')::text$s$, p3, hoy, hoy)));
  perform public.remove_manual_block(blk);
  perform pg_temp.rec('Quitar el bloqueo libera las noches', 'true',
    public.quote_stay('test-rt-g3', d + 20, d + 22, 2) ->> 'quotable');
  perform public.create_manual_block(p3, d + 30, d + 31, null, 'mantencion');
  perform pg_temp.as_postgres();

  -- ═══ 9. Calendarios iCal ═════════════════════════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('URL de otro sitio → rechazada', 'P0001',
    pg_temp.q(format($s$with x as (insert into public.external_calendars (property_id, channel, import_url) values (%L, 'airbnb', 'https://evil.example.com/x.ics') returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('URL sin https → rechazada', 'P0001',
    pg_temp.q(format($s$with x as (insert into public.external_calendars (property_id, channel, import_url) values (%L, 'airbnb', 'http://www.airbnb.cl/x.ics') returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('URL con usuario@ → rechazada', 'P0001',
    pg_temp.q(format($s$with x as (insert into public.external_calendars (property_id, channel, import_url) values (%L, 'airbnb', 'https://www.airbnb.cl@evil.com/x.ics') returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('Host parecido (airbnb.cl.evil.com) → rechazada', 'P0001',
    pg_temp.q(format($s$with x as (insert into public.external_calendars (property_id, channel, import_url) values (%L, 'airbnb', 'https://airbnb.cl.evil.com/x.ics') returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('URL de Airbnb válida → aceptada', '1',
    pg_temp.q(format($s$with x as (insert into public.external_calendars (property_id, channel, name, import_url) values (%L, 'airbnb', 'Airbnb', 'https://www.airbnb.cl/calendar/ical/123.ics?s=SECRETOabcdef9876') returning 1) select count(*)::text from x$s$, p)));
  perform pg_temp.rec('URL de Booking válida → aceptada', '1',
    pg_temp.q(format($s$with x as (insert into public.external_calendars (property_id, channel, name, import_url) values (%L, 'booking', 'Booking', 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=SECRETObooking1234') returning 1) select count(*)::text from x$s$, p)));
  select id into cal from public.external_calendars where property_id = p and channel = 'airbnb';
  perform pg_temp.rec('Lista del panel: URL enmascarada (sin el token)', 'https://www.airbnb.cl/••••9876|false',
    (select url_masked || '|' || (url_masked like '%SECRETO%')::text from public.admin_external_calendars(p) where id = cal));
  perform pg_temp.rec('Lista del panel: estado pendiente y token de exportación de 48 hex', 'pendiente|true',
    (select status || '|' || (export_token ~ '^[0-9a-f]{48}$')::text from public.admin_external_calendars(p) where id = cal));
  perform pg_temp.rec('Editar a una URL inválida → rechazado', 'P0001',
    pg_temp.q(format($s$update public.external_calendars set import_url = 'https://evil.example.com/y.ics' where id = %L returning 'x'$s$, cal)));
  perform pg_temp.rec('Desactivar → permitido', 'x',
    pg_temp.q(format($s$update public.external_calendars set is_active = false where id = %L returning 'x'$s$, cal)));
  update public.external_calendars set is_active = true where id = cal;

  -- "Sincronizar ahora": permiso y pausa de 60 s por propiedad.
  perform pg_temp.rec('Sincronizar ahora: primera vez → ok', 'true', public.admin_claim_ical_sync(p) ->> 'ok');
  perform pg_temp.rec('Sincronizar ahora: otra vez antes de 60 s → espera', 'cooldown',
    public.admin_claim_ical_sync(p) ->> 'reason');
  perform pg_temp.rec('Sincronizar ahora: propiedad sin calendarios', 'no_calendars',
    public.admin_claim_ical_sync(p5) ->> 'reason');
  perform pg_temp.as_postgres();

  -- Choques explicados (registro como lo haría la importación).
  insert into public.calendar_conflicts (property_id, external_calendar_id, external_uid, rejected_stay, conflict_type, conflicting_occupancy_id)
    values (p, cal, 'uid-test', daterange(m + 40, m + 42), 'hold',
            (select id from public.calendar_occupancies where property_id = p2 and kind = 'hold' limit 1));
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Choques abiertos de la propiedad', 'hold|airbnb',
    (select conflict_type || '|' || channel from public.admin_calendar_conflicts(p)));
  perform pg_temp.as_postgres();

  -- ═══ 10. Calendario de precios y simulador ═══════════════════════════
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Calendario: una fila por noche', '31',
    (select count(*)::text from public.admin_price_calendar(p, m, m + 31)));
  perform pg_temp.rec('Calendario: Año Nuevo con su precio, prioridad y mínimo', '90000|season|Año Nuevo|3|2',
    (select price_clp || '|' || kind || '|' || season_name || '|' || season_priority || '|' || min_nights
       from public.admin_price_calendar(p, m, m + 31) where day = m + 7));
  perform pg_temp.rec('Calendario: reserva, hold y bloqueo visibles con la definición única', 'reservation|hold|manual_block|mantencion',
    (select occupancy_kind from public.admin_price_calendar(p3, d, d + 30) where day = d + 10) || '|' ||
    (select occupancy_kind from public.admin_price_calendar(p2, d, d + 3) where day = d) || '|' ||
    (select occupancy_kind || '|' || block_reason from public.admin_price_calendar(p3, d, d + 40) where day = d + 30));
  perform pg_temp.rec('Calendario: más de 400 días → rechazado', 'P0001',
    pg_temp.q(format($s$select count(*)::text from public.admin_price_calendar(%L, %L::date, %L::date + 401)$s$, p, hoy, hoy)));
  v := public.admin_quote(p5, d, d + 7, 2);
  perform pg_temp.rec('Simulador cotiza una propiedad en borrador (el público no la ve)', '702000|not_found',
    (v -> 'public' ->> 'total_clp') || '|' || (public.quote_stay('test-rt-draft', d, d + 7, 2) ->> 'reason'));
  perform pg_temp.rec('Simulador = cotización pública de una publicada (mismo resultado exacto)', 'true',
    ((public.admin_quote(p2, m, m + 7, 2) -> 'public') = public.quote_stay('test-rt-g2', m, m + 7, 2))::text);
  perform pg_temp.rec('Simulador: plan de pago y desglose interno solo para el admin', 'true|true|ok',
    (v ? 'plan')::text || '|' || (v ? 'internal')::text || '|' || (v -> 'internal' ->> 'tax_status'));
  perform pg_temp.rec('Simulador: nada tributario en la parte pública', '0',
    (select count(*)::text from jsonb_object_keys(v -> 'public') k where k ~* '(net|vat|iva|tax|impuesto|rebate)'));
  perform pg_temp.as_postgres();

  -- ═══ 11. Historial (solo nombres de campos) y concurrencia ═══════════
  perform pg_temp.as_role('authenticated', v_admin);
  update public.external_calendars set import_url = 'https://www.airbnb.cl/calendar/ical/123.ics?s=NUEVOSECRETO5555' where id = cal;
  perform pg_temp.as_postgres();
  perform pg_temp.rec('Historial: cambio de URL iCal registra el campo, no el valor', 'import_url',
    (select array_to_string(changed_fields, ',') from public.admin_audit_log
      where table_name = 'external_calendars' and operation = 'UPDATE' and 'import_url' = any (changed_fields) order by id desc limit 1));
  perform pg_temp.rec('Historial: ninguna fila contiene la URL ni el token', '0',
    (select count(*)::text from public.admin_audit_log a where a.at >= now() - interval '1 hour'
       and (to_jsonb(a)::text like '%SECRETO%' or to_jsonb(a)::text like '%airbnb%')));
  perform pg_temp.rec('Historial: temporadas y descuentos quedan en la ficha de su tarifa', 'true|true',
    (exists (select 1 from public.admin_audit_log where table_name = 'rate_seasons' and record_id = g3::text))::text || '|' ||
    (exists (select 1 from public.admin_audit_log where table_name = 'rate_long_stay_discounts' and record_id = g3::text and operation = 'DELETE'))::text);
  perform pg_temp.rec('Historial: cambio de precio de la tarifa (campos, sin montos)', 'base_nightly_gross_clp,cleaning_fee_gross_clp',
    (select array_to_string(changed_fields, ',') from public.admin_audit_log
      where table_name = 'rate_groups' and record_id = g3::text and operation = 'UPDATE' order by id desc limit 1));
  perform pg_temp.rec('Historial: bloqueos (crear, quitar, crear) en la ficha de la propiedad; reservas no', 'INSERT|UPDATE|INSERT',
    (select string_agg(operation, '|' order by id) from public.admin_audit_log where table_name = 'calendar_occupancies' and record_id = p3::text));
  perform pg_temp.rec('Historial: la sincronización (último intento) no ensucia el historial', '0',
    (select count(*)::text from public.admin_audit_log where table_name = 'external_calendars' and 'last_attempt_at' = any (changed_fields)));
  perform pg_temp.as_role('authenticated', v_admin);
  perform pg_temp.rec('Tarifa editada en otro dispositivo → 40001', '40001',
    pg_temp.q(format($s$update public.rate_groups set name = 'TEST G2 b', updated_at = '2000-01-01' where id = %L returning 'x'$s$, g2)));
  perform pg_temp.rec('Temporada editada en otro dispositivo → 40001', '40001',
    pg_temp.q(format($s$update public.rate_seasons set name = 'Verano b', updated_at = '2000-01-01' where rate_group_id = %L and name = 'Verano' returning 'x'$s$, g)));
  perform pg_temp.as_postgres();

  -- ═══ 12. Permisos: público y encargado ═══════════════════════════════
  perform pg_temp.as_role('anon');
  perform pg_temp.rec('Anon: leer descuentos', 'denegado', pg_temp.q('select count(*)::text from public.rate_long_stay_discounts'));
  perform pg_temp.rec('Anon: admin_quote', 'denegado', pg_temp.q(format($s$select public.admin_quote(%L, %L::date, %L::date + 3, 2)::text$s$, p, d, d)));
  perform pg_temp.rec('Anon: admin_price_calendar', 'denegado', pg_temp.q(format($s$select count(*)::text from public.admin_price_calendar(%L, %L::date, %L::date + 3)$s$, p, d, d)));
  perform pg_temp.rec('Anon: admin_external_calendars', 'denegado', pg_temp.q(format($s$select count(*)::text from public.admin_external_calendars(%L)$s$, p)));
  perform pg_temp.rec('Anon: admin_calendar_conflicts', 'denegado', pg_temp.q(format($s$select count(*)::text from public.admin_calendar_conflicts(%L)$s$, p)));
  perform pg_temp.rec('Anon: admin_claim_ical_sync', 'denegado', pg_temp.q(format($s$select public.admin_claim_ical_sync(%L)::text$s$, p)));
  perform pg_temp.rec('Anon: create_manual_block', 'denegado', pg_temp.q(format($s$select public.create_manual_block(%L, %L::date + 200, %L::date + 201, null, 'otro')::text$s$, p, hoy, hoy)));
  perform pg_temp.rec('Anon: night_price / effective_min_nights', 'denegado|denegado',
    pg_temp.q(format($s$select count(*)::text from public.night_price(%L, %L::date)$s$, g, hoy)) || '|' ||
    pg_temp.q(format($s$select public.effective_min_nights(%L, %L::date)::text$s$, p, hoy)));
  perform pg_temp.rec('Anon: la cotización pública sigue funcionando', 'true', public.quote_stay('test-rt-g2', m, m + 2, 2) ->> 'quotable');
  perform pg_temp.as_role('authenticated', u_enc);
  perform pg_temp.rec('Encargado: no ve descuentos ni tarifas', '0|0',
    pg_temp.q('select count(*)::text from public.rate_long_stay_discounts') || '|' || pg_temp.q('select count(*)::text from public.rate_groups'));
  perform pg_temp.rec('Encargado: crear temporada', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.rate_seasons (rate_group_id, name, dates, nightly_gross_clp) values (%L, 'X enc', daterange(%L::date + 300, %L::date + 301), 50000) returning 1) select count(*)::text from x$s$, g2, hoy, hoy)));
  perform pg_temp.rec('Encargado: crear descuento', 'denegado',
    pg_temp.q(format($s$with x as (insert into public.rate_long_stay_discounts (rate_group_id, min_nights, percent) values (%L, 3, 5) returning 1) select count(*)::text from x$s$, g2)));
  perform pg_temp.rec('Encargado: admin_quote / calendario / iCal / sincronizar', 'denegado|denegado|denegado|denegado',
    pg_temp.q(format($s$select public.admin_quote(%L, %L::date, %L::date + 3, 2)::text$s$, p, d, d)) || '|' ||
    pg_temp.q(format($s$select count(*)::text from public.admin_price_calendar(%L, %L::date, %L::date + 3)$s$, p, d, d)) || '|' ||
    pg_temp.q(format($s$select count(*)::text from public.admin_external_calendars(%L)$s$, p)) || '|' ||
    pg_temp.q(format($s$select public.admin_claim_ical_sync(%L)::text$s$, p)));
  perform pg_temp.rec('Encargado: create_manual_block / remove_manual_block', 'denegado|denegado',
    pg_temp.q(format($s$select public.create_manual_block(%L, %L::date + 200, %L::date + 201, null, 'otro')::text$s$, p, hoy, hoy)) || '|' ||
    pg_temp.q(format($s$select 'x' from (select public.remove_manual_block(%L)) s$s$, blk)));
  perform pg_temp.rec('Encargado: no lee el historial', '0', pg_temp.q('select count(*)::text from public.admin_audit_log'));
  perform pg_temp.as_postgres();
end;
$$;

-- ═══ 13. publish_property sigue exigiendo 90 noches con precio ═════════
-- Con la regla "precio > 0" ya no se puede guardar una tarifa sin precio.
-- En la base LOCAL se quita la regla dentro de esta transacción (DDL, se
-- deshace con el ROLLBACK) para probar el comportamiento. En producción no
-- se ejecuta DDL (decisión de René): se verifica que la regla siga en la
-- definición de property_publish_check.
do $$
declare
  v_admin uuid := (select id from public.app_users where role = 'admin' and is_active limit 1);
  p uuid := (select id from public.properties where slug = 'test-rt-g2');
  v_missing text[];
begin
  if coalesce((select value from public.app_settings where key = 'environment'), '') = 'local' then
    execute 'alter table public.rate_groups drop constraint rate_groups_base_range';
    update public.rate_groups set base_nightly_gross_clp = 0, dow_gross_clp = null where name = 'TEST G2';
    perform pg_temp.as_role('authenticated', v_admin);
    v_missing := public.property_publish_check(p);
    perform pg_temp.as_postgres();
    perform pg_temp.rec('Tarifa sin precio en las próximas 90 noches → falta para publicar', 'true',
      (exists (select 1 from unnest(v_missing) x where x like 'La tarifa no tiene precio para % de las próximas 90 noches.'))::text);
  else
    perform pg_temp.rec('publish_property sigue revisando 90 noches con precio [producción: sin DDL, por definición]', 'true',
      (pg_get_functiondef('public.property_publish_check(uuid)'::regprocedure) like '%v_today + 89%'
       and pg_get_functiondef('public.property_publish_check(uuid)'::regprocedure) like '%de las próximas 90 noches%')::text);
  end if;
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
