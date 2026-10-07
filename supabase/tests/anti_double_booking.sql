-- Pruebas anti-doble-reserva (CLAUDE.md §4.7).
-- Corren contra la base remota sin dejar datos: todo ocurre dentro de una
-- transacción que termina en ROLLBACK.
--   npx supabase db query --linked -f supabase/tests/anti_double_booking.sql
-- Resultado: una fila por caso con esperado/obtenido y OK o FALLA.

begin;

create temp table test_results (
  n         serial,
  caso      text,
  esperado  text,
  obtenido  text
) on commit drop;

-- Ejecuta una sentencia y resume el resultado. Cada llamada es una
-- subtransacción: si la base la rechaza, solo se deshace esa sentencia.
create function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'permitido';
exception
  when exclusion_violation then return 'bloqueado';
  when check_violation then return 'rechazado';
end;
$$;

create function pg_temp.rec(p_caso text, p_esperado text, p_obtenido text) returns void language sql as $$
  insert into test_results (caso, esperado, obtenido) values (p_caso, p_esperado, p_obtenido);
$$;

-- Crea una reserva (y por trigger, su ocupación) para el huésped de prueba.
create function pg_temp.res(
  p_property uuid, p_in date, p_out date,
  p_status text default 'confirmada', p_hold_expires timestamptz default null
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.reservations (property_id, guest_id, owner_id, status, check_in, check_out, hold_expires_at)
  select p.id, (select id from public.guests where email = 'prueba@test.invalid'), p.owner_id,
         p_status::public.reservation_status, p_in, p_out, p_hold_expires
    from public.properties p
   where p.id = p_property
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare
  v_owner uuid;
  p1 uuid;
  p2 uuid;
  v_cal uuid;
  r uuid;
  r_a uuid;
  r_b uuid;
  r_c uuid;
  v_n integer;
  v_txt text;
begin
  -- Datos de prueba (desaparecen con el rollback).
  insert into public.owners (kind, legal_name, rut) values ('empresa', 'TEST Owner', 'TEST-1')
    returning id into v_owner;
  insert into public.properties (owner_id, slug, name, city) values (v_owner, 'test-p1', 'Test 1', 'Iquique')
    returning id into p1;
  insert into public.properties (owner_id, slug, name, city) values (v_owner, 'test-p2', 'Test 2', 'Iquique')
    returning id into p2;
  insert into public.guests (full_name, email) values ('Huésped Prueba', 'prueba@test.invalid');
  insert into public.external_calendars (property_id, channel, import_url)
    values (p1, 'airbnb', 'https://example.invalid/airbnb.ics') returning id into v_cal;

  -- Base: reserva confirmada en p1, 10 al 15 de enero.
  perform pg_temp.res(p1, '2030-01-10', '2030-01-15');

  -- 1. Dos reservas solapadas en la misma propiedad.
  perform pg_temp.rec('1. Dos reservas solapadas (misma propiedad)', 'bloqueado',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-01-12', '2030-01-17')));

  -- Extra: solapamiento de una sola noche.
  perform pg_temp.rec('1b. Solapa solo la última noche', 'bloqueado',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-01-14', '2030-01-20')));

  -- 2. Reserva + bloqueo manual.
  perform pg_temp.rec('2. Reserva + bloqueo manual solapados', 'bloqueado',
    pg_temp.attempt(format(
      'insert into public.calendar_occupancies (property_id, stay, kind) values (%L, %L, %L)',
      p1, '[2030-01-11,2030-01-13)', 'manual_block')));

  -- 3. Reserva + bloqueo iCal.
  perform pg_temp.rec('3. Reserva + bloqueo iCal solapados', 'bloqueado',
    pg_temp.attempt(format(
      'insert into public.calendar_occupancies (property_id, stay, kind, external_calendar_id, external_uid) values (%L, %L, %L, %L, %L)',
      p1, '[2030-01-13,2030-01-16)', 'ical_block', v_cal, 'evento-1@airbnb')));

  -- 4. El día de salida queda libre para la siguiente llegada.
  perform pg_temp.rec('4. Check-out = check-in de la siguiente', 'permitido',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-01-15', '2030-01-18')));

  -- 5. Mismas fechas en otra propiedad.
  perform pg_temp.rec('5. Mismas fechas, propiedad distinta', 'permitido',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p2, '2030-01-10', '2030-01-15')));

  -- 6. Hold activo bloquea; hold vencido y liberado ya no.
  perform pg_temp.res(p1, '2030-02-01', '2030-02-05', 'hold', now() + interval '20 minutes');
  perform pg_temp.rec('6a. Hold activo bloquea las fechas', 'bloqueado',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-02-03', '2030-02-06')));

  r := pg_temp.res(p1, '2030-02-10', '2030-02-12', 'hold', now() - interval '1 minute');
  perform pg_temp.rec('6b. Hold vencido, antes de que corra el job: sigue bloqueando', 'bloqueado',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-02-10', '2030-02-12')));
  perform public.release_expired_holds();
  select r2.status || '/' || o.status into v_txt
    from public.reservations r2 join public.calendar_occupancies o on o.reservation_id = r2.id
   where r2.id = r;
  perform pg_temp.rec('6c. El job libera el hold vencido (reserva/ocupación)', 'cancelada/released', v_txt);
  perform pg_temp.rec('6d. Hold vencido y liberado ya no bloquea', 'permitido',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-02-10', '2030-02-12')));
  perform pg_temp.rec('6e. El hold activo (no vencido) no se liberó', 'bloqueado',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-02-01', '2030-02-05')));

  -- 7. Una reserva cancelada libera las fechas.
  r := pg_temp.res(p1, '2030-03-01', '2030-03-05');
  update public.reservations set status = 'cancelada', cancellation_reason = 'cliente' where id = r;
  perform pg_temp.rec('7. Reserva cancelada libera las fechas', 'permitido',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-03-01', '2030-03-05')));

  -- Extra: confirmar un hold no abre ninguna ventana (misma fila de ocupación).
  r := pg_temp.res(p1, '2030-04-01', '2030-04-05', 'hold', now() + interval '20 minutes');
  update public.reservations set status = 'confirmada', hold_expires_at = null where id = r;
  select o.kind || '/' || o.status || '/' || coalesce(o.expires_at::text, 'sin_vencimiento') into v_txt
    from public.calendar_occupancies o where o.reservation_id = r;
  perform pg_temp.rec('8a. Hold → confirmada: misma ocupación, sin vencimiento', 'reservation/active/sin_vencimiento', v_txt);
  perform pg_temp.rec('8b. Tras confirmar, las fechas siguen bloqueadas', 'bloqueado',
    pg_temp.attempt(format('select pg_temp.res(%L, %L, %L)', p1, '2030-04-02', '2030-04-03')));

  -- Extra: rango vacío.
  perform pg_temp.rec('9. Ocupación con rango vacío', 'rechazado',
    pg_temp.attempt(format(
      'insert into public.calendar_occupancies (property_id, stay, kind) values (%L, %L, %L)',
      p2, 'empty', 'manual_block')));

  -- Extra: protocolo de conflicto (import iCal choca con reserva pagada).
  r := pg_temp.res(p1, '2030-05-01', '2030-05-05');
  perform pg_temp.rec('10a. iCal choca con reserva pagada: inserción', 'bloqueado',
    pg_temp.attempt(format(
      'insert into public.calendar_occupancies (property_id, stay, kind, external_calendar_id, external_uid) values (%L, %L, %L, %L, %L)',
      p1, '[2030-05-03,2030-05-07)', 'ical_block', v_cal, 'evento-2@airbnb')));
  v_n := public.register_calendar_conflict(v_cal, 'evento-2@airbnb', '[2030-05-03,2030-05-07)', 'Reserva Airbnb');
  select r2.status || '/' || o.status into v_txt
    from public.reservations r2 join public.calendar_occupancies o on o.reservation_id = r2.id
   where r2.id = r;
  perform pg_temp.rec('10b. Reserva pasa a conflicto y sus noches siguen bloqueadas', 'conflicto/active', v_txt);
  v_n := v_n + public.register_calendar_conflict(v_cal, 'evento-2@airbnb', '[2030-05-03,2030-05-07)', 'Reserva Airbnb');
  perform pg_temp.rec('10c. Conflicto registrado una sola vez (import repetido)', '1',
    (select count(*)::text from public.calendar_conflicts where external_uid = 'evento-2@airbnb'));

  -- Pago en curso: margen antes de liberar un hold vencido.
  r_a := pg_temp.res(p2, '2030-07-01', '2030-07-03', 'hold', now() - interval '5 minutes');
  insert into public.payments (reservation_id, provider, status, amount_clp) values (r_a, 'flow', 'pendiente', 100000);
  r_b := pg_temp.res(p2, '2030-07-10', '2030-07-12', 'hold', now() - interval '5 minutes');
  r_c := pg_temp.res(p2, '2030-07-20', '2030-07-22', 'hold', now() - interval '5 minutes');
  insert into public.payments (reservation_id, provider, status, amount_clp, created_at)
    values (r_c, 'flow', 'pendiente', 100000, now() - interval '45 minutes');
  perform public.release_expired_holds();
  perform pg_temp.rec('11a. Hold vencido con pago pendiente reciente: NO se libera', 'hold',
    (select status::text from public.reservations where id = r_a));
  perform pg_temp.rec('11b. Hold vencido sin pago pendiente: se libera', 'cancelada',
    (select status::text from public.reservations where id = r_b));
  perform pg_temp.rec('11c. Hold vencido con pago pendiente de hace 45 min: se libera', 'cancelada',
    (select status::text from public.reservations where id = r_c));
  update public.payments set status = 'rechazado' where reservation_id = r_a;
  perform public.release_expired_holds();
  perform pg_temp.rec('11d. Si ese pago falla, el hold se libera', 'cancelada',
    (select status::text from public.reservations where id = r_a));
end;
$$;

select n as "#", caso, esperado, obtenido,
       case when esperado = obtenido then 'OK' else 'FALLA' end as resultado
  from test_results
 order by n;

rollback;
