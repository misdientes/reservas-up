-- Sesión 10a: pagos manuales y parciales (transferencia y link TUU).
-- Decisiones de René: abono = max(30 %, primera noche), plazo de 12 h para
-- pagar, saldo 48 h antes de la llegada (si no alcanza, 100 %), todo
-- configurable por propiedad con valores globales en app_settings.
-- "Esperando pago manual" = reserva 'hold' con payment_mode = 'manual': la
-- definición ÚNICA de noche ocupada, el job release_expired_holds y la
-- restricción de exclusión la cubren sin cambios.

-- ─── Tipos ───────────────────────────────────────────────────────────────
create type public.payment_method as enum ('bank_transfer', 'payment_link', 'gateway');
create type public.payment_installment as enum ('deposit', 'balance', 'full');

-- ─── Valores globales (no públicos: el público los recibe ya calculados) ─
insert into public.app_settings (key, value, is_public) values
  ('deposit_percent', '30', false),
  ('deposit_min_nights', '1', false),
  ('manual_payment_window_hours', '12', false),
  ('balance_due_hours_before_checkin', '48', false),
  ('allowed_payment_methods', 'bank_transfer,payment_link', false)
on conflict (key) do nothing;

-- ─── Cuentas de cobro (base para la pasarela de S10b) ────────────────────
-- Los datos bancarios reales se cargan desde privado/ (nunca en git). Las
-- claves de una pasarela NUNCA van aquí: solo el NOMBRE del secreto.
create table public.payment_accounts (
  id                  uuid primary key default gen_random_uuid(),
  -- Titular. Puede no ser el dueño de la propiedad (UP cobra por cuenta de terceros).
  owner_id            uuid not null references public.owners (id) on delete restrict,
  label               text not null,
  provider            public.payment_provider,
  bank_name           text,
  account_type        text,
  account_number      text,
  holder_name         text,
  holder_rut          text,
  holder_email        text,
  gateway_secret_name text check (gateway_secret_name is null or gateway_secret_name ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.payment_accounts enable row level security;
revoke all on public.payment_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.payment_accounts to authenticated;
create policy payment_accounts_admin_all on public.payment_accounts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─── Ajustes por propiedad (null = valor global) ─────────────────────────
alter table public.properties
  add column deposit_percent                  smallint check (deposit_percent between 0 and 100),
  add column deposit_min_nights               smallint check (deposit_min_nights between 0 and 30),
  add column manual_payment_window_hours      smallint check (manual_payment_window_hours between 1 and 72),
  add column balance_due_hours_before_checkin smallint check (balance_due_hours_before_checkin between 0 and 720),
  add column allowed_payment_methods          public.payment_method[],
  add column cancellation_free_days           smallint check (cancellation_free_days between 0 and 365),
  add column cancellation_refund_percent      smallint check (cancellation_refund_percent between 0 and 100),
  add column payment_account_id               uuid references public.payment_accounts (id) on delete restrict;

-- ─── Código corto de referencia ("UP-4K7QM") ────────────────────────────
-- Es el que se escribe en el comentario de la transferencia y en WhatsApp.
-- Sin caracteres ambiguos (0/O, 1/I/L). NO sirve para consultar el estado:
-- eso exige el código secreto de 128 bits del enlace (public_code).
create function public.new_reservation_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(5);
    v_code := 'UP-';
    for i in 0..4 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.reservations where code = v_code);
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.new_reservation_code() from public, anon;
grant execute on function public.new_reservation_code() to authenticated, service_role;

alter table public.reservations alter column code set default public.new_reservation_code();

-- ─── Reserva: plan de pago y montos ──────────────────────────────────────
alter table public.reservations
  add column payment_mode         text not null default 'gateway' check (payment_mode in ('gateway', 'manual')),
  add column payment_method       public.payment_method,
  add column payment_plan         text check (payment_plan in ('deposit', 'full')),
  add column deposit_required_clp integer check (deposit_required_clp >= 0),
  add column balance_due_at       timestamptz,
  add column payment_account_id   uuid references public.payment_accounts (id) on delete restrict,
  add column amount_paid          integer not null default 0 check (amount_paid >= 0),
  add column cancelled_by         uuid,
  add column cancellation_note    text check (cancellation_note is null or length(cancellation_note) <= 500);

alter table public.reservations
  add column balance_due     integer generated always as (greatest(total_clp - amount_paid, 0)) stored,
  -- Acceso (cerradura, instrucciones: S11) solo con la reserva pagada completa.
  add column access_released boolean generated always as
    (status = 'confirmada' and total_clp > 0 and amount_paid >= total_clp) stored;

-- Reservas anteriores a esta sesión (pagadas por pasarela): lo pagado es la
-- suma de sus cobros aprobados, sin superar el total.
update public.reservations r
   set amount_paid = least(r.total_clp, coalesce((select sum(p.amount_clp) from public.payments p
                                                    where p.reservation_id = r.id and p.kind = 'cobro' and p.status = 'aprobado'), 0))
 where r.status in ('confirmada', 'completada');

-- ─── Pagos: varios por reserva, manuales o de pasarela ───────────────────
alter table public.payments alter column provider drop not null;
alter table public.payments
  add column method             public.payment_method not null default 'gateway',
  add column installment        public.payment_installment,
  add column reference          text check (reference is null or length(reference) between 1 and 120),
  add column received_at        timestamptz,
  add column registered_by      uuid,
  add column note               text check (note is null or length(note) <= 500),
  add column payment_account_id uuid references public.payment_accounts (id) on delete restrict,
  add constraint payments_gateway_has_provider check (method <> 'gateway' or provider is not null),
  add constraint payments_manual_has_reference check (method = 'gateway' or reference is not null);

-- Idempotencia de los pagos manuales: un n.º de operación por medio.
create unique index payments_method_reference_key on public.payments (method, reference) where reference is not null;

-- ─── Política de pago efectiva: UNA sola fuente ─────────────────────────
create function public.payment_policy(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'deposit_percent', coalesce(p.deposit_percent, public.setting_int('deposit_percent', 30)),
    'deposit_min_nights', coalesce(p.deposit_min_nights, public.setting_int('deposit_min_nights', 1)),
    'manual_payment_window_hours', coalesce(p.manual_payment_window_hours, public.setting_int('manual_payment_window_hours', 12)),
    'balance_due_hours_before_checkin', coalesce(p.balance_due_hours_before_checkin, public.setting_int('balance_due_hours_before_checkin', 48)),
    'allowed_payment_methods', to_jsonb(coalesce(
      p.allowed_payment_methods,
      (select array_agg(trim(m))::public.payment_method[]
         from unnest(string_to_array(coalesce((select value from public.app_settings where key = 'allowed_payment_methods'), 'bank_transfer,payment_link'), ',')) m
        where trim(m) <> ''))),
    'cancellation_free_days', coalesce(p.cancellation_free_days, public.setting_int('cancellation_free_days', 5)),
    'cancellation_refund_percent', coalesce(p.cancellation_refund_percent, public.setting_int('cancellation_refund_percent', 100)),
    'check_in_time', coalesce(p.check_in_time, time '15:00')
  )
  from public.properties p
  where p.id = p_property_id;
$$;

-- Plan de pago de una estadía ya cotizada (total y noches de pricing_core).
--   abono = min(total, max(round(total × %), suma de las N primeras noches))
--   llegada = check_in + hora de check-in, en Chile
--   saldo vence = llegada − H horas
--   plazo manual = min(ahora + plazo, llegada)
--   si ahora + plazo ≥ vencimiento del saldo → se exige el 100 % (nadie
--   reserva con abono si el saldo vencería durante el plazo de pago).
create function public.payment_plan_core(
  p_property_id uuid,
  p_check_in date,
  p_total_clp integer,
  p_nights jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb := public.payment_policy(p_property_id);
  v_window interval := make_interval(hours => (v_policy ->> 'manual_payment_window_hours')::integer);
  v_first_nights integer;
  v_deposit integer;
  v_arrival timestamptz;
  v_balance_due_at timestamptz;
  v_requires_full boolean;
begin
  select coalesce(sum((e.n ->> 'price_clp')::integer), 0) into v_first_nights
    from jsonb_array_elements(coalesce(p_nights, '[]'::jsonb)) with ordinality e(n, i)
   where e.i <= (v_policy ->> 'deposit_min_nights')::integer;

  v_deposit := least(p_total_clp, greatest(round(p_total_clp * (v_policy ->> 'deposit_percent')::numeric / 100)::integer, v_first_nights));
  v_arrival := (p_check_in + (v_policy ->> 'check_in_time')::time) at time zone 'America/Santiago';
  v_balance_due_at := v_arrival - make_interval(hours => (v_policy ->> 'balance_due_hours_before_checkin')::integer);
  v_requires_full := p_now + v_window >= v_balance_due_at;
  if v_requires_full then
    v_deposit := p_total_clp;
  end if;

  return jsonb_build_object(
    'total_clp', p_total_clp,
    'deposit_clp', v_deposit,
    'balance_clp', p_total_clp - v_deposit,
    'requires_full', v_requires_full,
    'arrival_at', v_arrival,
    'balance_due_at', v_balance_due_at,
    'manual_expires_at', least(p_now + v_window, v_arrival),
    'manual_payment_window_hours', (v_policy ->> 'manual_payment_window_hours')::integer,
    'allowed_payment_methods', v_policy -> 'allowed_payment_methods'
  );
end;
$$;

-- Público: plan de pago para el checkout (solo precios finales).
create function public.quote_payment_plan(p_slug text, p_check_in date, p_check_out date, p_guests integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_quote jsonb;
  v_plan jsonb;
begin
  select id into v_id from public.properties where slug = p_slug and status = 'publicada';
  if v_id is null then
    return jsonb_build_object('quotable', false, 'reason', 'not_found');
  end if;
  v_quote := public.pricing_core(v_id, p_check_in, p_check_out, p_guests);
  if not (v_quote ->> 'quotable')::boolean then
    return jsonb_build_object('quotable', false, 'reason', v_quote -> 'reason');
  end if;
  v_plan := public.payment_plan_core(v_id, p_check_in, (v_quote ->> 'total_clp')::integer, v_quote -> 'nights');
  return jsonb_build_object(
    'quotable', true,
    'total_clp', v_plan -> 'total_clp',
    'deposit_clp', v_plan -> 'deposit_clp',
    'balance_clp', v_plan -> 'balance_clp',
    'requires_full', v_plan -> 'requires_full',
    'balance_due_at', v_plan -> 'balance_due_at',
    'manual_payment_window_hours', v_plan -> 'manual_payment_window_hours',
    'allowed_payment_methods', v_plan -> 'allowed_payment_methods',
    'cancellation_free_days', public.payment_policy(v_id) -> 'cancellation_free_days',
    'cancellation_refund_percent', public.payment_policy(v_id) -> 'cancellation_refund_percent'
  );
end;
$$;

-- Estado de pago derivado (para el admin y el huésped).
create function public.reservation_payment_state(p_res public.reservations)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_res.needs_refund then 'reembolso_pendiente'
    when p_res.status = 'hold' and p_res.hold_expires_at < now() then 'vencida'
    when p_res.status = 'hold' then 'esperando_pago'
    when p_res.status in ('confirmada', 'completada') and p_res.amount_paid >= p_res.total_clp then 'pagada'
    when p_res.status in ('confirmada', 'completada') and p_res.balance_due_at is not null and now() > p_res.balance_due_at then 'saldo_vencido'
    when p_res.status in ('confirmada', 'completada') then 'abonada'
    else 'sin_pago'
  end;
$$;

-- ─── Hold: ahora con medio y plan de pago ────────────────────────────────
drop function public.create_booking_hold(text, date, date, integer, text, text, text, text, jsonb, text, integer);

create function public.create_booking_hold(
  p_slug text,
  p_check_in date,
  p_check_out date,
  p_guests integer,
  p_name text,
  p_email text,
  p_phone text,
  p_country text,
  p_invoice jsonb,
  p_client_ip_hash text,
  p_expected_total_clp integer,
  p_payment_method text default 'gateway',
  p_payment_plan text default 'full'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.properties%rowtype;
  v_quote jsonb;
  v_plan jsonb;
  v_policy jsonb;
  v_total integer;
  v_email text := lower(trim(p_email));
  v_guest_id uuid;
  v_terms uuid;
  v_privacy uuid;
  v_cancel uuid;
  v_free_days integer;
  v_refund_pct integer;
  v_hold_minutes integer := public.setting_int('hold_minutes', 20);
  v_today date := (now() at time zone 'America/Santiago')::date;
  v_free_until date;
  v_invoice boolean := coalesce((p_invoice ->> 'requested')::boolean, false);
  v_commission numeric(5,4) := 0;
  v_method public.payment_method;
  v_manual boolean;
  v_res public.reservations%rowtype;
begin
  -- Candado: sin modo 'online' no se toman holds (producción hoy: WhatsApp).
  if coalesce((select value from public.app_settings where key = 'booking_mode'), 'whatsapp') <> 'online' then
    return jsonb_build_object('ok', false, 'reason', 'booking_disabled');
  end if;

  if p_payment_method not in ('bank_transfer', 'payment_link', 'gateway') or p_payment_plan not in ('deposit', 'full') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_option');
  end if;
  v_method := p_payment_method::public.payment_method;
  v_manual := v_method <> 'gateway';

  select * into v_prop from public.properties where slug = p_slug and status = 'publicada';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Regla 3: si la revalidación con Airbnb/Booking falló y el último éxito
  -- tiene más de 15 minutos, no se toma el hold.
  if not public.property_sync_fresh(v_prop.id, 15) then
    return jsonb_build_object('ok', false, 'reason', 'sync_stale');
  end if;

  -- Máximo 2 holds activos por email y por IP (anti-acaparamiento; incluye
  -- los manuales de 12 h).
  if (select count(*) from public.reservations r
       where r.status = 'hold' and r.hold_expires_at > now() and lower(r.contact_email) = v_email) >= 2
     or (p_client_ip_hash is not null and (select count(*) from public.reservations r
       where r.status = 'hold' and r.hold_expires_at > now() and r.client_ip_hash = p_client_ip_hash) >= 2) then
    return jsonb_build_object('ok', false, 'reason', 'hold_limit');
  end if;

  -- El total sale SOLO del motor de precios.
  v_quote := public.pricing_core(v_prop.id, p_check_in, p_check_out, p_guests);
  if not (v_quote ->> 'quotable')::boolean then
    return jsonb_build_object('ok', false, 'reason', v_quote ->> 'reason', 'quote', v_quote);
  end if;
  v_total := (v_quote ->> 'total_clp')::integer;

  -- El navegador muestra un total; si el precio cambió, se pide confirmar.
  if p_expected_total_clp is distinct from v_total then
    return jsonb_build_object('ok', false, 'reason', 'price_changed', 'total_clp', v_total);
  end if;

  v_policy := public.payment_policy(v_prop.id);
  v_plan := public.payment_plan_core(v_prop.id, p_check_in, v_total, v_quote -> 'nights');
  if not (v_policy -> 'allowed_payment_methods') ? p_payment_method then
    return jsonb_build_object('ok', false, 'reason', 'method_not_allowed');
  end if;
  -- La pasarela (S10b) cobra hoy el total; el abono es solo para pagos manuales.
  if p_payment_plan = 'deposit' and (not v_manual or (v_plan ->> 'requires_full')::boolean) then
    return jsonb_build_object('ok', false, 'reason', 'full_payment_required', 'total_clp', v_total);
  end if;
  if v_method = 'bank_transfer' and v_prop.payment_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'payment_account_missing');
  end if;

  v_terms := public.current_legal_document('terminos');
  v_privacy := public.current_legal_document('privacidad');
  v_cancel := public.current_legal_document('cancelacion');
  if v_terms is null or v_privacy is null or v_cancel is null then
    return jsonb_build_object('ok', false, 'reason', 'legal_missing');
  end if;

  -- Huésped único por email: si ya existe, NO se sobrescriben sus datos.
  insert into public.guests (full_name, email, phone, country)
  values (trim(p_name), v_email, nullif(trim(p_phone), ''), nullif(trim(p_country), ''))
  on conflict (email_normalized) do nothing;
  select id into v_guest_id from public.guests where email_normalized = v_email;

  if v_prop.manager_id is not null then
    select default_commission_rate into v_commission from public.managers where id = v_prop.manager_id;
  end if;

  v_free_days := (v_policy ->> 'cancellation_free_days')::integer;
  v_refund_pct := (v_policy ->> 'cancellation_refund_percent')::integer;
  v_free_until := p_check_in - v_free_days;

  begin
    insert into public.reservations (
      property_id, guest_id, owner_id, manager_id, commission_rate, channel, status,
      check_in, check_out, adults, children, hold_expires_at, total_clp,
      contact_name, contact_email, contact_phone, contact_country, client_ip_hash,
      terms_document_id, privacy_document_id, cancellation_document_id, consent_at, cancellation_policy,
      invoice_requested, invoice_rut, invoice_business_name, invoice_activity, invoice_address,
      payment_mode, payment_method, payment_plan, deposit_required_clp, balance_due_at, payment_account_id
    )
    values (
      v_prop.id, v_guest_id, v_prop.owner_id, v_prop.manager_id, coalesce(v_commission, 0), 'directo', 'hold',
      p_check_in, p_check_out, p_guests, 0,
      case when v_manual then (v_plan ->> 'manual_expires_at')::timestamptz
           else now() + make_interval(mins => v_hold_minutes) end,
      v_total,
      trim(p_name), v_email, nullif(trim(p_phone), ''), nullif(trim(p_country), ''), p_client_ip_hash,
      v_terms, v_privacy, v_cancel, now(),
      jsonb_build_object('free_days', v_free_days, 'refund_percent', v_refund_pct,
                         'free_until', v_free_until, 'refundable_at_booking', v_today <= v_free_until),
      v_invoice,
      case when v_invoice then nullif(trim(p_invoice ->> 'rut'), '') end,
      case when v_invoice then nullif(trim(p_invoice ->> 'business_name'), '') end,
      case when v_invoice then nullif(trim(p_invoice ->> 'activity'), '') end,
      case when v_invoice then nullif(trim(p_invoice ->> 'address'), '') end,
      case when v_manual then 'manual' else 'gateway' end, v_method, p_payment_plan,
      (v_plan ->> 'deposit_clp')::integer, (v_plan ->> 'balance_due_at')::timestamptz, v_prop.payment_account_id
    )
    returning * into v_res;
  exception
    -- La restricción anti-doble-reserva decide: alguien tomó las fechas.
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_res.id,
    'public_code', v_res.public_code,
    'code', v_res.code,
    'total_clp', v_total,
    'payment_mode', v_res.payment_mode,
    'deposit_clp', v_res.deposit_required_clp,
    'requires_full', (v_plan ->> 'requires_full')::boolean,
    'hold_expires_at', v_res.hold_expires_at
  );
end;
$$;

revoke execute on function public.create_booking_hold(text, date, date, integer, text, text, text, text, jsonb, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_booking_hold(text, date, date, integer, text, text, text, text, jsonb, text, integer, text, text) to service_role;

-- ─── Recuperar una reserva cuyo hold ya se liberó (pago tardío) ──────────
-- Misma lógica para la pasarela (confirm_payment) y los pagos manuales
-- (register_manual_payment): si las fechas siguen libres se reocupan y la
-- reserva se confirma; la restricción de exclusión decide al final.
create function public.try_reoccupy(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations where id = p_reservation_id;
  if (public.pricing_core(v_res.property_id, v_res.check_in, v_res.check_out, v_res.adults + v_res.children, v_res.id)
        ->> 'reason') is distinct from 'unavailable'
     and not exists (select 1 from public.occupied_ranges(v_res.property_id, v_res.id) r(stay)
                      where r.stay && daterange(v_res.check_in, v_res.check_out, '[)')) then
    begin
      update public.reservations
         set status = 'confirmada', confirmed_at = now(), hold_expires_at = null,
             cancellation_reason = null, cancelled_at = null, cancelled_by = null, cancellation_note = null
       where id = p_reservation_id;
      return true;
    exception when exclusion_violation then
      return false; -- alguien tomó las fechas en el último instante
    end;
  end if;
  return false;
end;
$$;

-- ─── Confirmación por pasarela: ahora registra lo pagado ─────────────────
create or replace function public.confirm_payment(
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_status text,
  p_amount_clp integer,
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_res public.reservations%rowtype;
begin
  select * into v_pay from public.payments
   where provider = p_provider and provider_payment_id = p_provider_payment_id
   for update;
  if not found then
    insert into public.payment_incidents (kind, detail)
    values ('unknown_payment', jsonb_build_object('provider', p_provider, 'provider_payment_id', p_provider_payment_id, 'status', p_status));
    return jsonb_build_object('ok', false, 'outcome', 'unknown_payment');
  end if;

  if v_pay.status <> 'pendiente' then
    return jsonb_build_object('ok', true, 'outcome', 'already_processed', 'payment_status', v_pay.status);
  end if;

  select * into v_res from public.reservations where id = v_pay.reservation_id for update;

  -- Pago fallido o abandonado: se libera el hold.
  if p_status in ('rejected', 'abandoned') then
    update public.payments
       set status = case when p_status = 'rejected' then 'rechazado'::public.payment_status else 'anulado'::public.payment_status end,
           raw_payload = p_payload
     where id = v_pay.id;
    if v_res.status = 'hold' then
      update public.reservations
         set status = 'cancelada', cancellation_reason = 'pago_' || case when p_status = 'rejected' then 'rechazado' else 'abandonado' end,
             cancelled_at = now()
       where id = v_res.id;
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'released');
  end if;

  if p_status <> 'approved' then
    raise exception 'Estado de pago desconocido: %', p_status using errcode = '22023';
  end if;

  -- Desde aquí el dinero se recibió: el pago queda aprobado pase lo que pase.
  update public.payments
     set status = 'aprobado', paid_at = now(), received_at = now(), raw_payload = p_payload,
         installment = coalesce(installment, 'full'), payment_account_id = coalesce(payment_account_id, v_res.payment_account_id)
   where id = v_pay.id;

  -- Monto distinto al total: no se confirma.
  if p_amount_clp is distinct from v_pay.amount_clp or p_amount_clp is distinct from v_res.total_clp then
    insert into public.payment_incidents (payment_id, reservation_id, kind, detail)
    values (v_pay.id, v_res.id, 'amount_mismatch',
            jsonb_build_object('received_clp', p_amount_clp, 'expected_clp', v_res.total_clp));
    update public.reservations set needs_refund = true, refund_reason = 'monto_distinto' where id = v_res.id;
    if v_res.status = 'hold' then
      update public.reservations
         set status = 'cancelada', cancellation_reason = 'monto_distinto', cancelled_at = now()
       where id = v_res.id;
    end if;
    return jsonb_build_object('ok', false, 'outcome', 'amount_mismatch');
  end if;

  -- Ya confirmada por otro pago: este sobra.
  if v_res.status in ('confirmada', 'completada', 'conflicto') then
    insert into public.payment_incidents (payment_id, reservation_id, kind, detail)
    values (v_pay.id, v_res.id, 'duplicate_payment', null);
    update public.reservations set needs_refund = true, refund_reason = 'pago_duplicado' where id = v_res.id;
    return jsonb_build_object('ok', false, 'outcome', 'duplicate_payment');
  end if;

  -- Un canal externo vendió esas noches mientras se pagaba.
  if exists (select 1 from public.calendar_conflicts k
              where k.reservation_id = v_res.id and k.resolved_at is null and k.conflict_type = 'hold') then
    insert into public.payment_incidents (payment_id, reservation_id, kind) values (v_pay.id, v_res.id, 'conflict_hold');
    update public.reservations
       set needs_refund = true, refund_reason = 'conflicto_ical',
           status = case when status = 'hold' then 'cancelada'::public.reservation_status else status end,
           cancellation_reason = coalesce(cancellation_reason, 'conflicto_ical'),
           cancelled_at = coalesce(cancelled_at, now())
     where id = v_res.id;
    return jsonb_build_object('ok', false, 'outcome', 'needs_refund');
  end if;

  -- Caso normal: el hold sigue ocupando → confirmada (misma ocupación).
  if v_res.status = 'hold' then
    update public.reservations
       set status = 'confirmada', confirmed_at = now(), hold_expires_at = null,
           amount_paid = amount_paid + p_amount_clp
     where id = v_res.id;
    return jsonb_build_object('ok', true, 'outcome', 'confirmed');
  end if;

  -- Pago aprobado tarde: el hold ya se liberó.
  if v_res.status = 'cancelada' then
    if public.try_reoccupy(v_res.id) then
      update public.reservations set amount_paid = amount_paid + p_amount_clp where id = v_res.id;
      return jsonb_build_object('ok', true, 'outcome', 'late_confirmed');
    end if;
    insert into public.payment_incidents (payment_id, reservation_id, kind)
    values (v_pay.id, v_res.id, 'late_approval_unavailable');
    update public.reservations
       set needs_refund = true, refund_reason = 'pago_tardio_sin_fechas', amount_paid = amount_paid + p_amount_clp
     where id = v_res.id;
    return jsonb_build_object('ok', false, 'outcome', 'needs_refund');
  end if;

  return jsonb_build_object('ok', false, 'outcome', 'unexpected_status', 'reservation_status', v_res.status);
end;
$$;

-- ─── Registro de pagos manuales (solo admin) ─────────────────────────────
-- "Confirma solo cuando veas el dinero en tu banco, nunca por una foto del
-- comprobante." Idempotente por (medio, n.º de operación).
create function public.register_manual_payment(
  p_reservation_id uuid,
  p_method text,
  p_amount_clp integer,
  p_reference text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_existing public.payments%rowtype;
  v_ref text := nullif(trim(p_reference), '');
  v_method public.payment_method;
  v_installment public.payment_installment;
  v_outcome text;
  v_pay_id uuid;
  v_after public.reservations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede registrar pagos' using errcode = '42501';
  end if;
  if p_method not in ('bank_transfer', 'payment_link') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_method');
  end if;
  v_method := p_method::public.payment_method;
  if p_amount_clp is null or p_amount_clp <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;
  if v_ref is null then
    return jsonb_build_object('ok', false, 'reason', 'reference_required');
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Idempotencia: el mismo n.º de operación no se registra dos veces.
  select * into v_existing from public.payments where method = v_method and reference = v_ref;
  if found then
    if v_existing.reservation_id = v_res.id and v_existing.amount_clp = p_amount_clp then
      return jsonb_build_object('ok', true, 'outcome', 'already_registered',
                                'amount_paid', v_res.amount_paid, 'balance_due', v_res.balance_due,
                                'fully_paid', v_res.amount_paid >= v_res.total_clp);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'duplicate_reference');
  end if;

  if p_amount_clp > v_res.total_clp - v_res.amount_paid then
    return jsonb_build_object('ok', false, 'reason', 'amount_exceeds_balance',
                              'balance_due', v_res.total_clp - v_res.amount_paid);
  end if;

  -- Primer pago: debe cubrir al menos el abono (o el total si se exige el 100 %).
  if v_res.amount_paid = 0 and p_amount_clp < coalesce(v_res.deposit_required_clp, v_res.total_clp) then
    return jsonb_build_object('ok', false, 'reason', 'below_deposit',
                              'deposit_clp', coalesce(v_res.deposit_required_clp, v_res.total_clp));
  end if;

  v_installment := case
    when v_res.amount_paid > 0 then 'balance'
    when p_amount_clp >= v_res.total_clp then 'full'
    else 'deposit' end::public.payment_installment;

  if v_res.status = 'hold' then
    v_outcome := 'confirmed';
  elsif v_res.status in ('confirmada', 'completada') then
    v_outcome := 'payment_registered';
  elsif v_res.status = 'cancelada' and v_res.cancellation_reason in ('hold_expirado', 'liberado_admin') and v_res.amount_paid = 0 then
    v_outcome := 'late';
  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', v_res.status);
  end if;

  insert into public.payments (reservation_id, provider, method, kind, installment, status, amount_clp,
                               reference, received_at, paid_at, registered_by, note, payment_account_id)
  values (v_res.id, null, v_method, 'cobro', v_installment, 'aprobado', p_amount_clp,
          v_ref, now(), now(), (select auth.uid()), nullif(trim(p_note), ''), v_res.payment_account_id)
  returning id into v_pay_id;

  if v_outcome = 'confirmed' then
    -- El trigger de la Sesión 9b congela el desglose UNA vez (sobre total_clp).
    update public.reservations
       set status = 'confirmada', confirmed_at = now(), hold_expires_at = null,
           amount_paid = amount_paid + p_amount_clp
     where id = v_res.id;
  elsif v_outcome = 'payment_registered' then
    update public.reservations set amount_paid = amount_paid + p_amount_clp where id = v_res.id;
  elsif public.try_reoccupy(v_res.id) then
    v_outcome := 'late_confirmed';
    update public.reservations set amount_paid = amount_paid + p_amount_clp where id = v_res.id;
  else
    v_outcome := 'needs_refund';
    insert into public.payment_incidents (payment_id, reservation_id, kind)
    values (v_pay_id, v_res.id, 'late_approval_unavailable');
    update public.reservations
       set needs_refund = true, refund_reason = 'pago_tardio_sin_fechas', amount_paid = amount_paid + p_amount_clp
     where id = v_res.id;
  end if;

  select * into v_after from public.reservations where id = v_res.id;
  return jsonb_build_object(
    'ok', v_outcome <> 'needs_refund',
    'outcome', v_outcome,
    'payment_id', v_pay_id,
    'amount_paid', v_after.amount_paid,
    'balance_due', v_after.balance_due,
    'fully_paid', v_after.amount_paid >= v_after.total_clp
  );
end;
$$;

-- ─── Liberar a mano un hold manual sin pagos (solo admin) ────────────────
create function public.release_manual_hold(p_reservation_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede liberar fechas' using errcode = '42501';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_res.status <> 'hold' or v_res.payment_mode <> 'manual' then
    return jsonb_build_object('ok', false, 'reason', 'not_manual_hold');
  end if;
  if v_res.amount_paid > 0 or exists (select 1 from public.payments where reservation_id = v_res.id) then
    return jsonb_build_object('ok', false, 'reason', 'has_payments');
  end if;

  update public.reservations
     set status = 'cancelada', cancellation_reason = 'liberado_admin', cancelled_at = now(),
         cancelled_by = (select auth.uid()), cancellation_note = nullif(trim(p_note), '')
   where id = v_res.id;
  return jsonb_build_object('ok', true, 'outcome', 'released');
end;
$$;

-- ─── Cola de pagos para el admin ─────────────────────────────────────────
create function public.admin_payment_queue()
returns table (
  reservation_id uuid,
  code text,
  property_name text,
  check_in date,
  check_out date,
  guests integer,
  contact_name text,
  contact_email text,
  contact_phone text,
  status public.reservation_status,
  payment_mode text,
  payment_method public.payment_method,
  payment_plan text,
  total_clp integer,
  deposit_required_clp integer,
  amount_paid integer,
  balance_due integer,
  balance_due_at timestamptz,
  hold_expires_at timestamptz,
  payment_state text,
  access_released boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los pagos' using errcode = '42501';
  end if;
  return query
    select r.id, r.code, p.name, r.check_in, r.check_out, r.adults + r.children,
           r.contact_name, r.contact_email, r.contact_phone,
           r.status, r.payment_mode, r.payment_method, r.payment_plan,
           r.total_clp, r.deposit_required_clp, r.amount_paid, r.balance_due, r.balance_due_at, r.hold_expires_at,
           public.reservation_payment_state(r), r.access_released, r.created_at
      from public.reservations r
      join public.properties p on p.id = r.property_id
     where (r.status = 'hold' and r.payment_mode = 'manual')
        or (r.status in ('confirmada', 'completada') and r.balance_due > 0)
        or r.needs_refund
     order by coalesce(r.hold_expires_at, r.balance_due_at, r.created_at);
end;
$$;

-- ─── Estado público: agrega el pago (datos bancarios solo con el enlace) ─
-- p_public_code es el código secreto de 128 bits del enlace. El código corto
-- (UP-XXXXX) no sirve para consultar. Los datos bancarios solo salen si hay
-- un monto pendiente por transferencia; nunca en vistas públicas.
create or replace function public.public_booking_status(p_public_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status',
             case
               when r.needs_refund then 'no_completada'
               when r.status in ('confirmada', 'completada') then 'confirmada'
               when r.status = 'conflicto' then 'en_revision'
               when r.status = 'hold' and r.payment_mode = 'manual' then 'esperando_pago'
               when r.status = 'hold' then 'procesando'
               else 'no_completada'
             end,
           'code', r.code,
           'property_name', p.name,
           'property_slug', p.slug,
           'check_in', r.check_in,
           'check_out', r.check_out,
           'nights', r.nights,
           'guests', r.adults + r.children,
           'total_clp', r.total_clp,
           'payment', jsonb_strip_nulls(jsonb_build_object(
             'mode', r.payment_mode,
             'method', r.payment_method,
             'plan', r.payment_plan,
             'state', public.reservation_payment_state(r),
             'deposit_clp', r.deposit_required_clp,
             'amount_paid', r.amount_paid,
             'balance_clp', r.balance_due,
             'balance_due_at', r.balance_due_at,
             'pay_now_clp', due.pay_now,
             'expires_at', case when r.status = 'hold' then r.hold_expires_at end,
             'bank', case when r.payment_method = 'bank_transfer' and due.pay_now > 0 and not r.needs_refund then
               (select jsonb_build_object('bank_name', a.bank_name, 'account_type', a.account_type,
                                          'account_number', a.account_number, 'holder_name', a.holder_name,
                                          'holder_rut', a.holder_rut, 'holder_email', a.holder_email)
                  from public.payment_accounts a where a.id = r.payment_account_id and a.is_active) end
           ))
         )
    from public.reservations r
    join public.properties p on p.id = r.property_id
    cross join lateral (
      select case
               when r.needs_refund then 0
               when r.status = 'hold' and r.payment_plan = 'deposit' then coalesce(r.deposit_required_clp, r.total_clp)
               when r.status = 'hold' then r.total_clp
               when r.status in ('confirmada', 'completada') then r.balance_due
               else 0
             end as pay_now
    ) due
   where p_public_code ~ '^[0-9a-f]{32}$'
     and r.public_code = p_public_code;
$$;

-- ─── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.payment_policy(uuid) from public, anon, authenticated;
revoke execute on function public.payment_plan_core(uuid, date, integer, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.try_reoccupy(uuid) from public, anon, authenticated;
revoke execute on function public.reservation_payment_state(public.reservations) from public, anon, authenticated;
revoke execute on function public.quote_payment_plan(text, date, date, integer) from public;
grant execute on function public.quote_payment_plan(text, date, date, integer) to anon, authenticated;
revoke execute on function public.register_manual_payment(uuid, text, integer, text, text) from public, anon;
grant execute on function public.register_manual_payment(uuid, text, integer, text, text) to authenticated;
revoke execute on function public.release_manual_hold(uuid, text) from public, anon;
grant execute on function public.release_manual_hold(uuid, text) to authenticated;
revoke execute on function public.admin_payment_queue() from public, anon;
grant execute on function public.admin_payment_queue() to authenticated;
