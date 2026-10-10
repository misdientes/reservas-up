-- Sesión 11 (Parte A de 10b+11): correos transaccionales.
-- Bandeja de salida (email_outbox) con clave de evento ÚNICA: un mismo evento
-- nunca envía dos correos. Los correos se encolan en la MISMA transacción que
-- el cambio de estado (triggers); un worker (Edge Function email-worker,
-- llamada por pg_cron) los envía vía Resend con reintentos y backoff.
-- Todas las horas se calculan en America/Santiago.

-- ─── Configuración (privada) ─────────────────────────────────────────────
insert into public.app_settings (key, value, is_public) values
  ('email_from_address', '', false),
  ('email_from_name', 'Reservas UP', false),
  ('admin_email', '', false)
on conflict (key) do nothing;

-- ─── Bandeja de salida ───────────────────────────────────────────────────
create table public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  event_key           text not null unique,
  template_key        text not null,
  recipient           text not null check (recipient in ('guest', 'admin')),
  to_email            text,
  reservation_id      uuid references public.reservations (id) on delete cascade,
  property_id         uuid references public.properties (id) on delete cascade,
  payload             jsonb not null default '{}'::jsonb,
  send_after          timestamptz not null default now(),
  status              text not null default 'pendiente'
                      check (status in ('pendiente', 'enviando', 'enviado', 'fallido', 'omitido')),
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  claimed_at          timestamptz,
  last_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);

create index email_outbox_due_idx on public.email_outbox (status, send_after, next_attempt_at);
create index email_outbox_reservation_idx on public.email_outbox (reservation_id);

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public, anon, authenticated;
grant select on public.email_outbox to authenticated;
create policy email_outbox_admin_select on public.email_outbox
  for select to authenticated using ((select public.is_admin()));

-- ─── Datos privados de llegada por propiedad ─────────────────────────────
create table public.property_arrival_info (
  property_id         uuid primary key references public.properties (id) on delete cascade,
  exact_address       text,
  access_instructions text,
  wifi_name           text,
  wifi_password       text,
  parking             text,
  notes               text,
  updated_at          timestamptz not null default now()
);

alter table public.property_arrival_info enable row level security;
revoke all on public.property_arrival_info from public, anon, authenticated;
grant select, insert, update, delete on public.property_arrival_info to authenticated;
create policy property_arrival_info_admin_all on public.property_arrival_info
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─── Plantillas: versión global + override opcional por propiedad ────────
alter table public.message_templates
  add column property_id uuid references public.properties (id) on delete cascade,
  add column version integer not null default 1;
alter table public.message_templates drop constraint message_templates_key_channel_language_key;
create unique index message_templates_global_key on public.message_templates (key, channel, language) where property_id is null;
create unique index message_templates_property_key on public.message_templates (key, channel, language, property_id) where property_id is not null;

-- ─── Horas en Chile ──────────────────────────────────────────────────────
-- Llegada = fecha de check-in + hora de check-in de la propiedad (15:00 si falta).
create function public.reservation_arrival_at(p_reservation_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (r.check_in + coalesce(p.check_in_time, time '15:00')) at time zone 'America/Santiago'
    from public.reservations r
    join public.properties p on p.id = r.property_id
   where r.id = p_reservation_id;
$$;

-- Resta un intervalo en hora LOCAL de Chile (cruza bien el cambio de horario).
create function public.chile_minus(p_at timestamptz, p_interval interval)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_at at time zone 'America/Santiago') - p_interval) at time zone 'America/Santiago';
$$;

-- ─── Encolar ─────────────────────────────────────────────────────────────
create function public.enqueue_email(
  p_event_key text,
  p_template_key text,
  p_recipient text,
  p_to_email text,
  p_reservation_id uuid,
  p_property_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_send_after timestamptz default now()
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.email_outbox (event_key, template_key, recipient, to_email, reservation_id, property_id, payload, send_after)
  values (p_event_key, p_template_key, p_recipient, nullif(trim(coalesce(p_to_email, '')), ''), p_reservation_id, p_property_id,
          coalesce(p_payload, '{}'::jsonb), coalesce(p_send_after, now()))
  on conflict (event_key) do nothing;
$$;

create function public.admin_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(trim(value), '') from public.app_settings where key = 'admin_email';
$$;

-- Correos por cada transición de la reserva (misma transacción).
create function public.reservations_enqueue_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text := 'res:' || new.id || ':';
  v_arrival timestamptz;
begin
  -- a) Reserva creada esperando pago manual (+ aviso al admin).
  if tg_op = 'INSERT' then
    if new.status = 'hold' and new.payment_mode = 'manual' then
      perform public.enqueue_email(k || 'booking_created', 'guest_booking_created', 'guest', new.contact_email, new.id, new.property_id);
      perform public.enqueue_email(k || 'admin_new_booking', 'admin_new_booking', 'admin', public.admin_email(), new.id, new.property_id);
    end if;
    return new;
  end if;

  -- b) Pago recibido: cada aumento de lo pagado con la reserva confirmada.
  if new.status in ('confirmada', 'completada') and new.amount_paid > old.amount_paid then
    perform public.enqueue_email(k || 'payment_received:' || new.amount_paid, 'guest_payment_received', 'guest', new.contact_email,
                                 new.id, new.property_id, jsonb_build_object('amount_clp', new.amount_paid - old.amount_paid));
  end if;

  -- c) Recordatorio de saldo: 24 h (hora de Chile) antes del vencimiento.
  if new.status = 'confirmada' and old.status is distinct from 'confirmada'
     and new.balance_due > 0 and new.balance_due_at is not null then
    perform public.enqueue_email(k || 'balance_reminder', 'guest_balance_reminder', 'guest', new.contact_email, new.id, new.property_id,
                                 '{}'::jsonb, greatest(now(), public.chile_minus(new.balance_due_at, interval '24 hours')));
  end if;

  -- e) Instrucciones de llegada al quedar pagada completa. Pagada con más de
  --    7 días de anticipación → se envía 3 días antes de la llegada (Chile).
  if new.access_released and not coalesce(old.access_released, false) then
    v_arrival := public.reservation_arrival_at(new.id);
    perform public.enqueue_email(k || 'arrival_info', 'guest_arrival_info', 'guest', new.contact_email, new.id, new.property_id,
                                 '{}'::jsonb,
                                 case when v_arrival - now() > interval '7 days'
                                      then public.chile_minus(v_arrival, interval '3 days') else now() end);
  end if;

  -- d) Liberada por falta de pago (hold manual vencido o liberado por el admin).
  if new.status = 'cancelada' and old.status = 'hold' and new.payment_mode = 'manual' and new.amount_paid = 0
     and new.cancellation_reason in ('hold_expirado', 'liberado_admin') then
    perform public.enqueue_email(k || 'released', 'guest_released', 'guest', new.contact_email, new.id, new.property_id);
  end if;

  -- Admin: un pago que requiere reembolso.
  if new.needs_refund and not old.needs_refund then
    perform public.enqueue_email(k || 'admin_refund', 'admin_refund_needed', 'admin', public.admin_email(), new.id, new.property_id,
                                 jsonb_build_object('refund_reason', new.refund_reason));
  end if;

  return new;
end;
$$;

create trigger reservations_enqueue_emails
  after insert or update on public.reservations
  for each row execute function public.reservations_enqueue_emails();

-- Admin: pago por pasarela aprobado.
create function public.payments_enqueue_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
begin
  if new.method = 'gateway' and new.kind = 'cobro' and new.status = 'aprobado'
     and (tg_op = 'INSERT' or old.status is distinct from 'aprobado') then
    select * into v_res from public.reservations where id = new.reservation_id;
    perform public.enqueue_email('pay:' || new.id || ':admin_gateway', 'admin_gateway_payment', 'admin', public.admin_email(),
                                 v_res.id, v_res.property_id, jsonb_build_object('amount_clp', new.amount_clp));
  end if;
  return new;
end;
$$;

create trigger payments_enqueue_emails
  after insert or update of status on public.payments
  for each row execute function public.payments_enqueue_emails();

-- Alertas programadas (job cada 15 min; idempotentes por event_key).
create function public.enqueue_scheduled_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before from public.email_outbox;

  -- Saldo vencido: se avisa una vez por reserva; la reserva NO se cancela.
  perform public.enqueue_email('res:' || r.id || ':admin_balance_overdue', 'admin_balance_overdue', 'admin', public.admin_email(),
                               r.id, r.property_id)
     from public.reservations r
    where r.status = 'confirmada' and r.balance_due > 0 and r.balance_due_at < now();

  -- Fuente iCal sin éxito hace más de 60 min: una alerta por caída.
  perform public.enqueue_email('cal:' || c.id || ':sync_alert:' || coalesce(c.last_success_at::text, 'nunca'), 'admin_sync_alert', 'admin',
                               public.admin_email(), null, c.property_id,
                               jsonb_build_object('calendar_id', c.id))
     from public.external_calendars c
    where c.is_active
      and c.last_attempt_at is not null
      and (c.last_success_at is null or c.last_success_at < now() - interval '60 minutes');

  select count(*) into v_after from public.email_outbox;
  return v_after - v_before;
end;
$$;

-- ─── Código de acceso por reserva (solo admin; reutiliza access_codes) ───
create function public.set_reservation_access_code(p_reservation_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_arrival timestamptz;
  v_departure timestamptz;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede cargar códigos de acceso' using errcode = '42501';
  end if;
  if v_code is null or length(v_code) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.status not in ('confirmada', 'completada') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  v_arrival := public.reservation_arrival_at(v_res.id);
  select (v_res.check_out + coalesce(p.check_out_time, time '11:00')) at time zone 'America/Santiago'
    into v_departure from public.properties p where p.id = v_res.property_id;

  select id into v_id from public.access_codes where reservation_id = v_res.id order by created_at desc limit 1;
  if v_id is null then
    insert into public.access_codes (property_id, reservation_id, code, valid_from, valid_to, status)
    values (v_res.property_id, v_res.id, v_code, v_arrival, greatest(v_departure, v_arrival + interval '1 hour'), 'activo')
    returning id into v_id;
  else
    update public.access_codes set code = v_code, status = 'activo', updated_at = now() where id = v_id;
  end if;

  -- Si las instrucciones de llegada ya se enviaron, el código va en un correo
  -- aparte (una vez por versión del código). Si aún no, irá en ese correo.
  if exists (select 1 from public.email_outbox
              where reservation_id = v_res.id and template_key = 'guest_arrival_info' and status = 'enviado') then
    perform public.enqueue_email('res:' || v_res.id || ':access_code:' || md5(v_code), 'guest_access_code', 'guest',
                                 v_res.contact_email, v_res.id, v_res.property_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Próximas llegadas (admin): para cargar códigos de acceso.
create function public.admin_upcoming_arrivals(p_days integer default 14)
returns table (
  reservation_id uuid,
  code text,
  property_name text,
  check_in date,
  check_out date,
  guests integer,
  contact_name text,
  access_released boolean,
  access_code text,
  arrival_email_status text,
  arrival_email_send_after timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver las llegadas' using errcode = '42501';
  end if;
  return query
    select r.id, r.code, p.name, r.check_in, r.check_out, r.adults + r.children, r.contact_name, r.access_released,
           (select a.code from public.access_codes a where a.reservation_id = r.id order by a.created_at desc limit 1),
           (select o.status from public.email_outbox o where o.reservation_id = r.id and o.template_key = 'guest_arrival_info'),
           (select o.send_after from public.email_outbox o where o.reservation_id = r.id and o.template_key = 'guest_arrival_info')
      from public.reservations r
      join public.properties p on p.id = r.property_id
     where r.status in ('confirmada', 'completada')
       and r.check_in between (now() at time zone 'America/Santiago')::date
                          and (now() at time zone 'America/Santiago')::date + greatest(1, least(p_days, 90))
     order by r.check_in;
end;
$$;

-- ─── Worker: tomar, contexto y resultado ─────────────────────────────────
-- Toma un lote listo para enviar. Antes devuelve a 'pendiente' los que
-- quedaron 'enviando' más de 10 min (el worker se cortó sin respuesta del
-- proveedor): sin sumar un intento extra. El Idempotency-Key de Resend
-- (= event_key) evita un duplicado si el primer envío sí había salido.
create function public.claim_emails(p_limit integer default 20)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_outbox
     set status = 'pendiente', attempts = greatest(attempts - 1, 0), claimed_at = null
   where status = 'enviando' and claimed_at < now() - interval '10 minutes';

  return query
    update public.email_outbox o
       set status = 'enviando', attempts = o.attempts + 1, claimed_at = now()
     where o.id in (
       select id from public.email_outbox
        where status = 'pendiente' and send_after <= now() and next_attempt_at <= now()
        order by send_after, created_at
        limit greatest(1, least(p_limit, 100))
        for update skip locked
     )
    returning o.*;
end;
$$;

-- Resultado del envío. Error → reintento con backoff 1, 2, 4, 8, 16 min;
-- al 6.º intento → 'fallido'. Omitido = ya no corresponde (p. ej. saldo pagado).
create function public.mark_email_result(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_provider_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.email_outbox where id = p_id;
  if p_status = 'enviado' then
    update public.email_outbox
       set status = 'enviado', sent_at = now(), provider_message_id = p_provider_message_id, last_error = null, claimed_at = null
     where id = p_id;
  elsif p_status = 'omitido' then
    update public.email_outbox set status = 'omitido', last_error = left(p_error, 500), claimed_at = null where id = p_id;
  else
    update public.email_outbox
       set status = case when v_attempts >= 6 then 'fallido' else 'pendiente' end,
           next_attempt_at = now() + make_interval(mins => power(2, greatest(v_attempts - 1, 0))::integer),
           last_error = left(p_error, 500),
           claimed_at = null
     where id = p_id;
  end if;
end;
$$;

-- Datos para renderizar un correo, leídos AL ENVIAR (un correo programado
-- refleja el estado actual). skip = el correo ya no corresponde.
create function public.email_context(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_o public.email_outbox%rowtype;
  v_res public.reservations%rowtype;
  v_prop public.properties%rowtype;
  v_tpl public.message_templates%rowtype;
  v_ctx jsonb := '{}'::jsonb;
  v_skip text;
begin
  select * into v_o from public.email_outbox where id = p_id;
  if not found then
    return jsonb_build_object('skip', 'no_existe');
  end if;

  if v_o.reservation_id is not null then
    select * into v_res from public.reservations where id = v_o.reservation_id;
  end if;
  select * into v_prop from public.properties where id = coalesce(v_res.property_id, v_o.property_id);

  -- ¿Sigue correspondiendo? Se evalúa AL ENVIAR: si los correos esperaron
  -- (por ejemplo, Resend aún sin configurar), al activarse no sale una
  -- ráfaga de correos viejos o que ya no aplican.
  v_skip := case
    -- Alertas al admin: solo sirven frescas (más de 24 h → omitida).
    when v_o.template_key like 'admin\_%' and v_o.created_at < now() - interval '24 hours' then 'alerta_antigua'
    when v_o.template_key = 'admin_balance_overdue' and (v_res.status <> 'confirmada' or v_res.balance_due = 0) then 'saldo_pagado'
    -- Huésped: la condición que originó el correo debe seguir vigente.
    when v_o.template_key = 'guest_booking_created' and (v_res.status <> 'hold' or v_res.hold_expires_at < now()) then 'ya_no_espera_pago'
    when v_o.template_key = 'guest_payment_received'
         and (v_res.status not in ('confirmada', 'completada') or v_res.needs_refund) then 'reserva_no_confirmada'
    when v_o.template_key = 'guest_balance_reminder'
         and (v_res.status <> 'confirmada' or v_res.balance_due = 0 or v_res.balance_due_at < now()) then 'saldo_pagado_o_vencido'
    when v_o.template_key = 'guest_released' and v_res.status <> 'cancelada' then 'reserva_recuperada'
    when v_o.template_key in ('guest_arrival_info', 'guest_access_code') and v_res.status not in ('confirmada', 'completada') then 'reserva_no_confirmada'
    when v_o.template_key like 'guest\_%' and v_res.check_out <= (now() at time zone 'America/Santiago')::date then 'estadia_terminada'
    -- Código de acceso: solo la versión vigente (la clave termina en md5 del código).
    when v_o.template_key = 'guest_access_code'
         and v_o.event_key not like '%:' || coalesce((select md5(a.code) from public.access_codes a
                                                       where a.reservation_id = v_res.id and a.status = 'activo'
                                                       order by a.created_at desc limit 1), '-') then 'codigo_reemplazado'
    when v_o.to_email is null then 'sin_destinatario'
  end;
  if v_skip is not null then
    return jsonb_build_object('skip', v_skip);
  end if;

  -- Plantilla: override de la propiedad → global.
  select * into v_tpl from public.message_templates t
   where t.key = v_o.template_key and t.channel = 'email' and t.language = 'es' and t.is_active
     and (t.property_id = v_prop.id or t.property_id is null)
   order by t.property_id nulls last
   limit 1;
  if not found then
    return jsonb_build_object('skip', 'sin_plantilla');
  end if;

  if v_res.id is not null then
    v_ctx := jsonb_build_object(
      'code', v_res.code,
      'public_code', v_res.public_code,
      'guest_name', split_part(coalesce(v_res.contact_name, ''), ' ', 1),
      'contact_name', v_res.contact_name,
      'contact_email', v_res.contact_email,
      'contact_phone', v_res.contact_phone,
      'check_in', v_res.check_in,
      'check_out', v_res.check_out,
      'nights', v_res.nights,
      'guests', v_res.adults + v_res.children,
      'total_clp', v_res.total_clp,
      'amount_paid_clp', v_res.amount_paid,
      'balance_clp', v_res.balance_due,
      'balance_due_at', v_res.balance_due_at,
      'expires_at', v_res.hold_expires_at,
      'pay_now_clp', case when v_res.payment_plan = 'deposit' and v_res.amount_paid = 0
                          then coalesce(v_res.deposit_required_clp, v_res.total_clp)
                          else v_res.balance_due end,
      'payment_method', v_res.payment_method,
      'fully_paid', v_res.amount_paid >= v_res.total_clp,
      'refund_reason', v_res.refund_reason,
      'access_code', (select a.code from public.access_codes a
                       where a.reservation_id = v_res.id and a.status = 'activo' order by a.created_at desc limit 1)
    );
    -- Datos bancarios: solo transferencia.
    if v_res.payment_method = 'bank_transfer' then
      v_ctx := v_ctx || coalesce((select jsonb_build_object('bank_name', a.bank_name, 'account_type', a.account_type,
                                         'account_number', a.account_number, 'holder_name', a.holder_name,
                                         'holder_rut', a.holder_rut, 'holder_email', a.holder_email)
                                    from public.payment_accounts a where a.id = v_res.payment_account_id), '{}'::jsonb);
    end if;
    -- Instrucciones de llegada: solo en los correos de llegada.
    if v_o.template_key in ('guest_arrival_info', 'guest_access_code') then
      v_ctx := v_ctx || coalesce((select jsonb_build_object('exact_address', coalesce(i.exact_address, v_prop.address),
                                         'access_instructions', i.access_instructions, 'wifi_name', i.wifi_name,
                                         'wifi_password', i.wifi_password, 'parking', i.parking, 'notes', i.notes)
                                    from public.property_arrival_info i where i.property_id = v_prop.id),
                                 jsonb_build_object('exact_address', v_prop.address));
    end if;
  end if;

  if v_o.template_key = 'admin_sync_alert' then
    v_ctx := v_ctx || coalesce((select jsonb_build_object('calendar_name', coalesce(c.name, c.channel::text), 'channel', c.channel,
                                       'last_success_at', c.last_success_at, 'last_error', c.last_sync_error)
                                  from public.external_calendars c where c.id = (v_o.payload ->> 'calendar_id')::uuid), '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'id', v_o.id,
    'event_key', v_o.event_key,
    'to_email', v_o.to_email,
    'template_key', v_o.template_key,
    'subject', v_tpl.subject,
    'body', v_tpl.body,
    'from_address', (select value from public.app_settings where key = 'email_from_address'),
    'from_name', coalesce((select nullif(value, '') from public.app_settings where key = 'email_from_name'), 'Reservas UP'),
    'vars', v_ctx || jsonb_build_object(
      'property_name', v_prop.name,
      'check_in_time', to_char(v_prop.check_in_time, 'HH24:MI'),
      'check_out_time', to_char(v_prop.check_out_time, 'HH24:MI')
    ) || v_o.payload
  );
end;
$$;

-- ─── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.reservation_arrival_at(uuid) from public, anon, authenticated;
revoke execute on function public.chile_minus(timestamptz, interval) from public, anon, authenticated;
revoke execute on function public.enqueue_email(text, text, text, text, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_email() from public, anon, authenticated;
revoke execute on function public.reservations_enqueue_emails() from public, anon, authenticated;
revoke execute on function public.payments_enqueue_emails() from public, anon, authenticated;
revoke execute on function public.enqueue_scheduled_alerts() from public, anon, authenticated;
revoke execute on function public.claim_emails(integer) from public, anon, authenticated;
revoke execute on function public.mark_email_result(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.email_context(uuid) from public, anon, authenticated;
grant execute on function public.claim_emails(integer) to service_role;
grant execute on function public.mark_email_result(uuid, text, text, text) to service_role;
grant execute on function public.email_context(uuid) to service_role;
revoke execute on function public.set_reservation_access_code(uuid, text) from public, anon;
grant execute on function public.set_reservation_access_code(uuid, text) to authenticated;
revoke execute on function public.admin_upcoming_arrivals(integer) from public, anon;
grant execute on function public.admin_upcoming_arrivals(integer) to authenticated;

-- ─── Plantillas globales (español; voz Costa y Pampa; sin impuestos) ─────
-- Formato: {{variable}}; {{#v}}…{{/v}} si v tiene valor; {{^v}}…{{/v}} si no.
-- Párrafos separados por línea en blanco; "- " para listas.
insert into public.message_templates (key, channel, language, subject, body) values
('guest_booking_created', 'email', 'es', 'Reservamos tus fechas · {{code}}', $t$Hola {{guest_name}}:

Apartamos {{property_name}} para ti, del {{check_in}} al {{check_out}} ({{guests}}).

Para confirmar tu reserva, paga {{pay_now}} hasta el {{expires_at}}. Si no recibimos el pago en ese plazo, las fechas se liberan.

{{#bank_name}}Datos para transferir:
- Banco: {{bank_name}}
- Tipo de cuenta: {{account_type}}
- Número de cuenta: {{account_number}}
- Titular: {{holder_name}}
- RUT: {{holder_rut}}
- Email: {{holder_email}}

Escribe el código {{code}} en el comentario de la transferencia.{{/bank_name}}{{#is_link}}Te enviaremos el link de pago por WhatsApp. Si no te llega, escríbenos indicando el código {{code}}.{{/is_link}}

Total de la estadía: {{total}}.

Revisa tu reserva aquí: {{booking_url}}$t$),

('guest_payment_received', 'email', 'es', 'Recibimos tu pago · {{code}}', $t$Hola {{guest_name}}:

Recibimos {{amount}} para tu reserva en {{property_name}}, del {{check_in}} al {{check_out}}.

{{#fully_paid}}Tu reserva está pagada completa. Te enviaremos las instrucciones de llegada antes de tu estadía.{{/fully_paid}}{{^fully_paid}}Tu reserva está confirmada. Queda un saldo de {{balance}}, que debe estar pagado hasta el {{balance_due_at}}.{{/fully_paid}}

Revisa tu reserva aquí: {{booking_url}}$t$),

('guest_balance_reminder', 'email', 'es', 'Recordatorio de saldo · {{code}}', $t$Hola {{guest_name}}:

Te recordamos que el saldo de {{balance}} de tu reserva en {{property_name}} vence el {{balance_due_at}}.

{{#bank_name}}Datos para transferir:
- Banco: {{bank_name}}
- Tipo de cuenta: {{account_type}}
- Número de cuenta: {{account_number}}
- Titular: {{holder_name}}
- RUT: {{holder_rut}}
- Email: {{holder_email}}

Escribe el código {{code}} en el comentario de la transferencia.{{/bank_name}}

Ve los datos de pago aquí: {{booking_url}}$t$),

('guest_released', 'email', 'es', 'Liberamos tus fechas · {{code}}', $t$Hola {{guest_name}}:

Como no recibimos el pago a tiempo, liberamos las fechas del {{check_in}} al {{check_out}} en {{property_name}}.

Si ya pagaste o quieres volver a reservar, escríbenos por WhatsApp indicando el código {{code}}.$t$),

('guest_arrival_info', 'email', 'es', 'Tu llegada a {{property_name}} · {{code}}', $t$Hola {{guest_name}}:

Todo listo para tu llegada el {{check_in}}{{#check_in_time}}, desde las {{check_in_time}}{{/check_in_time}}. La salida es el {{check_out}}{{#check_out_time}}, hasta las {{check_out_time}}{{/check_out_time}}.

{{#exact_address}}Dirección: {{exact_address}}{{/exact_address}}

{{#access_instructions}}Cómo entrar: {{access_instructions}}{{/access_instructions}}

{{#access_code}}Tu código de acceso: {{access_code}}{{/access_code}}{{^access_code}}Te enviaremos el código de acceso antes de tu llegada.{{/access_code}}

{{#wifi_name}}Wifi: {{wifi_name}} · Clave: {{wifi_password}}{{/wifi_name}}

{{#parking}}Estacionamiento: {{parking}}{{/parking}}

{{#notes}}{{notes}}{{/notes}}

Si necesitas algo, escríbenos por WhatsApp indicando el código {{code}}.$t$),

('guest_access_code', 'email', 'es', 'Tu código de acceso · {{code}}', $t$Hola {{guest_name}}:

Tu código de acceso para {{property_name}} es: {{access_code}}

Vale desde tu llegada el {{check_in}} hasta tu salida el {{check_out}}.$t$),

('admin_new_booking', 'email', 'es', 'Nueva reserva esperando pago · {{code}}', $t${{contact_name}} ({{contact_phone}}, {{contact_email}}) reservó {{property_name}} del {{check_in}} al {{check_out}} ({{guests}}).

Medio: {{method_label}}. Debe pagar {{pay_now}} hasta el {{expires_at}}. Total: {{total}}.

Registra el pago en el panel solo cuando veas el dinero en tu banco: {{admin_url}}$t$),

('admin_gateway_payment', 'email', 'es', 'Pago con tarjeta recibido · {{code}}', $t$Se recibió {{amount}} con tarjeta para {{property_name}}, del {{check_in}} al {{check_out}}. Pagado: {{amount_paid}} de {{total}}.

{{admin_url}}$t$),

('admin_refund_needed', 'email', 'es', 'Reembolso pendiente · {{code}}', $t$La reserva {{code}} de {{contact_name}} en {{property_name}} ({{check_in}} al {{check_out}}) recibió un pago, pero quedó para reembolso. Motivo: {{refund_reason}}. Pagado: {{amount_paid}}.

Revísala en el panel: {{admin_url}}$t$),

('admin_balance_overdue', 'email', 'es', 'Saldo vencido · {{code}}', $t$El saldo de {{balance}} de la reserva {{code}} ({{contact_name}}, {{contact_phone}}) en {{property_name}} venció el {{balance_due_at}}. La reserva sigue confirmada: coordina el pago con el huésped.

{{admin_url}}$t$),

('admin_sync_alert', 'email', 'es', 'Calendario sin sincronizar · {{property_name}}', $t$El calendario {{calendar_name}} ({{channel}}) de {{property_name}} no se sincroniza hace más de 60 minutos. Último éxito: {{last_success_at}}. Último error: {{last_error}}.

Mientras no se sincronice, las reservas directas de esa propiedad quedan en pausa (no se toman holds).$t$)
on conflict do nothing;

-- ─── Jobs ────────────────────────────────────────────────────────────────
-- Worker cada minuto (mismo patrón y mismo secreto compartido que ical-import).
select cron.schedule(
  'email-worker',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://ygsckeyfewlcitrwbywf.supabase.co/functions/v1/email-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ical_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- Alertas programadas (saldo vencido, iCal caído) cada 15 minutos.
select cron.schedule('email-alerts', '*/15 * * * *', $job$select public.enqueue_scheduled_alerts()$job$);
