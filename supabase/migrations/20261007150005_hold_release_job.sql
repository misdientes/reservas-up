-- Sesión 2 (5/5): liberación automática de holds vencidos (CLAUDE.md §4.2).

-- Margen para pagos en curso: si el huésped ya inició el pago, el hold no se
-- libera aunque haya vencido, hasta que el pago falle o pase este margen.
-- Es configurable sin tocar código; no es público.
insert into public.app_settings (key, value, is_public)
values ('hold_payment_grace_minutes', '30', false)
on conflict (key) do nothing;

-- Pasa a 'cancelada' (motivo hold_expirado) cada hold vencido sin un cobro
-- pendiente reciente. El trigger reservations_sync_occupancy libera sus
-- noches (ocupación 'released'). Devuelve cuántos holds liberó.
-- Mientras el job no corre, un hold vencido SIGUE bloqueando: el error, si
-- lo hay, es hacia el lado seguro (nunca se liberan noches antes de tiempo).
create function public.release_expired_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setting text;
  v_grace_minutes integer := 30;
  v_count integer;
begin
  select value into v_setting from public.app_settings where key = 'hold_payment_grace_minutes';
  if v_setting ~ '^\d{1,4}$' then
    v_grace_minutes := v_setting::integer;
  end if;

  with released as (
    update public.reservations r
       set status = 'cancelada',
           cancellation_reason = 'hold_expirado',
           cancelled_at = now()
     where r.status = 'hold'
       and r.hold_expires_at < now()
       and not exists (
         select 1
           from public.payments p
          where p.reservation_id = r.id
            and p.kind = 'cobro'
            and p.status = 'pendiente'
            and p.created_at > now() - make_interval(mins => v_grace_minutes)
       )
    returning r.id
  )
  select count(*) into v_count from released;

  return v_count;
end;
$$;

revoke execute on function public.release_expired_holds() from public, anon, authenticated;

-- Cada minuto. cron.schedule con nombre reemplaza el job si ya existía.
select cron.schedule(
  'release-expired-holds',
  '* * * * *',
  $job$select public.release_expired_holds()$job$
);
