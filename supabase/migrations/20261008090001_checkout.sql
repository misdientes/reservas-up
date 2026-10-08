-- Sesión 9: checkout con hold, pagos desacoplados (proveedor simulado solo
-- en local) y confirmación idempotente. Reglas: CLAUDE.md §4 y §5,
-- docs/checkout.md. El servidor decide todo: el navegador nunca envía un
-- monto a cobrar (expected_total_clp solo se compara).

-- ─── Configuración editable sin código ───────────────────────────────────
insert into public.app_settings (key, value, is_public) values
  -- 'whatsapp' (consultar) u 'online' (reservar y pagar). Producción: whatsapp.
  ('booking_mode', 'whatsapp', true),
  -- Cancelación moderada (decisión de René): 100 % hasta 5 días antes.
  ('cancellation_free_days', '5', true),
  ('cancellation_refund_percent', '100', true),
  -- Duración del hold (CLAUDE.md §4.2: 15–20 minutos).
  ('hold_minutes', '20', false)
on conflict (key) do nothing;

-- ─── Proveedor simulado: solo en la base local ───────────────────────────
-- El seed local crea app_settings.environment = 'local'; en producción esa
-- clave no existe, así que un pago 'mock' es imposible allí (segundo candado,
-- además del de la Edge Function).
alter type public.payment_provider add value if not exists 'mock';

create function public.payments_guard_mock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider::text = 'mock'
     and coalesce((select value from public.app_settings where key = 'environment'), '') <> 'local' then
    raise exception 'El proveedor de pago simulado solo existe en el entorno local' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.payments_guard_mock() from public, anon, authenticated;

create trigger payments_guard_mock
  before insert or update of provider on public.payments
  for each row execute function public.payments_guard_mock();

-- ─── Huéspedes: uno por email normalizado ────────────────────────────────
alter table public.guests
  add column email_normalized text generated always as (lower(trim(email))) stored;
create unique index guests_email_normalized_idx on public.guests (email_normalized);

-- ─── Reservas: código público, contacto, factura, política, reembolso ────
alter table public.reservations
  -- Código largo y no adivinable para /reserva/:code (el "code" corto queda
  -- para hablar por teléfono o WhatsApp).
  add column public_code text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  -- Copia de los datos de contacto ingresados en ESTA reserva: la
  -- comunicación usa esta copia (el huésped puede cambiar de teléfono).
  add column contact_name text,
  add column contact_email text,
  add column contact_phone text,
  add column contact_country text,
  -- Pago aprobado que no se pudo confirmar (fechas tomadas, monto distinto…).
  -- El reembolso automático llega en la Sesión 15; el aviso, en la 11.
  add column needs_refund boolean not null default false,
  add column refund_reason text,
  -- HMAC de la IP (nunca la IP): límite de holds por IP.
  add column client_ip_hash text,
  add column cancellation_document_id uuid references public.legal_documents (id) on delete restrict,
  -- Política congelada al reservar: días, porcentaje y fecha límite.
  add column cancellation_policy jsonb,
  -- Factura opcional (empresas).
  add column invoice_requested boolean not null default false,
  add column invoice_rut text,
  add column invoice_business_name text,
  add column invoice_activity text,
  add column invoice_address text,
  add constraint reservations_invoice_complete check (
    not invoice_requested
    or (invoice_rut is not null and invoice_business_name is not null
        and invoice_activity is not null and invoice_address is not null)
  );

create index reservations_active_holds_email_idx on public.reservations (lower(contact_email)) where status = 'hold';
create index reservations_active_holds_ip_idx on public.reservations (client_ip_hash) where status = 'hold';

-- ─── Incidentes de pago (solo admin) ─────────────────────────────────────
create table public.payment_incidents (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid references public.payments (id) on delete restrict,
  reservation_id uuid references public.reservations (id) on delete restrict,
  kind           text not null check (kind in ('amount_mismatch', 'late_approval_unavailable', 'conflict_hold', 'duplicate_payment', 'unknown_payment')),
  detail         jsonb,
  resolved_at    timestamptz,
  resolution     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.payment_incidents enable row level security;
revoke all on table public.payment_incidents from anon, authenticated;
grant select, update on table public.payment_incidents to authenticated;
create policy admin_all on public.payment_incidents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create trigger payment_incidents_set_updated_at
  before update on public.payment_incidents
  for each row execute function public.set_updated_at();

-- ─── Ayudantes ───────────────────────────────────────────────────────────
create function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when value ~ '^\d{1,6}$' then value::integer else p_default end
    from (select (select value from public.app_settings where key = p_key) as value) s;
$$;

-- Propiedad publicada por slug (para que create-booking sincronice antes).
create function public.published_property_id(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.properties where slug = p_slug and status = 'publicada';
$$;

-- ¿Los calendarios externos de la propiedad se sincronizaron con éxito hace
-- poco? (CLAUDE.md §4.3). Sin calendarios externos activos: sí.
create function public.property_sync_fresh(p_property_id uuid, p_max_minutes integer default 15)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from public.external_calendars c
     where c.property_id = p_property_id
       and c.is_active
       and c.import_url is not null
       and coalesce(c.last_success_at, '-infinity'::timestamptz) < now() - make_interval(mins => p_max_minutes)
  );
$$;

-- Versión vigente de un documento legal.
create function public.current_legal_document(p_kind public.legal_document_kind)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.legal_documents
   where kind = p_kind and published_at is not null and published_at <= now()
   order by published_at desc, created_at desc
   limit 1;
$$;

-- ─── Crear el hold ───────────────────────────────────────────────────────
-- La llama create-booking DESPUÉS de verificar Turnstile, validar y
-- sincronizar el iCal. Todo en una transacción; devuelve {ok, reason…}.
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
  p_expected_total_clp integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.properties%rowtype;
  v_quote jsonb;
  v_total integer;
  v_email text := lower(trim(p_email));
  v_guest_id uuid;
  v_terms uuid;
  v_privacy uuid;
  v_cancel uuid;
  v_free_days integer := public.setting_int('cancellation_free_days', 5);
  v_refund_pct integer := public.setting_int('cancellation_refund_percent', 100);
  v_hold_minutes integer := public.setting_int('hold_minutes', 20);
  v_today date := (now() at time zone 'America/Santiago')::date;
  v_free_until date;
  v_invoice boolean := coalesce((p_invoice ->> 'requested')::boolean, false);
  v_commission numeric(5,4) := 0;
  v_res public.reservations%rowtype;
begin
  select * into v_prop from public.properties where slug = p_slug and status = 'publicada';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Regla 3: si la revalidación con Airbnb/Booking falló y el último éxito
  -- tiene más de 15 minutos, no se toma el hold.
  if not public.property_sync_fresh(v_prop.id, 15) then
    return jsonb_build_object('ok', false, 'reason', 'sync_stale');
  end if;

  -- Máximo 2 holds activos por email y por IP (anti-acaparamiento).
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

  v_free_until := p_check_in - v_free_days;

  begin
    insert into public.reservations (
      property_id, guest_id, owner_id, manager_id, commission_rate, channel, status,
      check_in, check_out, adults, children, hold_expires_at, total_clp,
      contact_name, contact_email, contact_phone, contact_country, client_ip_hash,
      terms_document_id, privacy_document_id, cancellation_document_id, consent_at, cancellation_policy,
      invoice_requested, invoice_rut, invoice_business_name, invoice_activity, invoice_address
    )
    values (
      v_prop.id, v_guest_id, v_prop.owner_id, v_prop.manager_id, coalesce(v_commission, 0), 'directo', 'hold',
      p_check_in, p_check_out, p_guests, 0, now() + make_interval(mins => v_hold_minutes), v_total,
      trim(p_name), v_email, nullif(trim(p_phone), ''), nullif(trim(p_country), ''), p_client_ip_hash,
      v_terms, v_privacy, v_cancel, now(),
      jsonb_build_object('free_days', v_free_days, 'refund_percent', v_refund_pct,
                         'free_until', v_free_until, 'refundable_at_booking', v_today <= v_free_until),
      v_invoice,
      case when v_invoice then nullif(trim(p_invoice ->> 'rut'), '') end,
      case when v_invoice then nullif(trim(p_invoice ->> 'business_name'), '') end,
      case when v_invoice then nullif(trim(p_invoice ->> 'activity'), '') end,
      case when v_invoice then nullif(trim(p_invoice ->> 'address'), '') end
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
    'total_clp', v_total,
    'hold_expires_at', v_res.hold_expires_at
  );
end;
$$;

-- Justo antes de crear el cobro (y al confirmar): un hold con un choque
-- abierto de tipo 'hold' (un canal vendió esas noches mientras el huésped
-- pagaba) NO se cobra: se cancela.
create function public.assert_hold_chargeable(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.status <> 'hold' then
    return jsonb_build_object('ok', false, 'reason', 'not_hold');
  end if;
  if v_res.hold_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'hold_expired');
  end if;
  if exists (select 1 from public.calendar_conflicts k
              where k.reservation_id = p_reservation_id and k.resolved_at is null and k.conflict_type = 'hold') then
    update public.reservations
       set status = 'cancelada', cancellation_reason = 'conflicto_ical', cancelled_at = now()
     where id = p_reservation_id;
    return jsonb_build_object('ok', false, 'reason', 'conflict_hold');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Cancelar un hold que no llegó a cobrarse (p. ej. falló el proveedor).
create function public.cancel_booking_hold(p_reservation_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reservations
     set status = 'cancelada', cancellation_reason = p_reason, cancelled_at = now()
   where id = p_reservation_id and status = 'hold';
$$;

-- Registrar el cobro creado en el proveedor (pendiente).
create function public.attach_payment(
  p_reservation_id uuid,
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_amount_clp integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_id uuid;
begin
  select total_clp into v_total from public.reservations where id = p_reservation_id and status = 'hold';
  if v_total is null or v_total <> p_amount_clp then
    raise exception 'El cobro no corresponde al total de la reserva' using errcode = '22023';
  end if;
  insert into public.payments (reservation_id, provider, provider_payment_id, kind, status, amount_clp)
  values (p_reservation_id, p_provider, p_provider_payment_id, 'cobro', 'pendiente', p_amount_clp)
  returning id into v_id;
  return v_id;
end;
$$;

-- ─── Confirmación (webhook) ──────────────────────────────────────────────
-- Idempotente: el mismo aviso N veces no duplica nada (FOR UPDATE + un pago
-- que ya no está 'pendiente' no se reprocesa). La confirmación ocurre SOLO
-- aquí, nunca por la redirección del navegador (CLAUDE.md §5).
-- p_status: 'approved' | 'rejected' | 'abandoned'.
create function public.confirm_payment(
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
  update public.payments set status = 'aprobado', paid_at = now(), raw_payload = p_payload where id = v_pay.id;

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

  -- Caso normal: el hold sigue ocupando (vigente, o vencido aún sin liberar)
  -- → confirmada. El trigger convierte la MISMA ocupación: nunca se liberan
  -- las fechas entre el hold y la confirmación.
  if v_res.status = 'hold' then
    update public.reservations
       set status = 'confirmada', confirmed_at = now(), hold_expires_at = null
     where id = v_res.id;
    return jsonb_build_object('ok', true, 'outcome', 'confirmed');
  end if;

  -- Pago aprobado tarde: el hold ya se liberó. Si las fechas siguen libres
  -- (pricing_core con exclude = la reserva) se reocupan y se confirma; si
  -- no, queda para reembolso. La restricción de exclusión decide al final.
  if v_res.status = 'cancelada' then
    if (public.pricing_core(v_res.property_id, v_res.check_in, v_res.check_out, v_res.adults + v_res.children, v_res.id)
          ->> 'reason') is distinct from 'unavailable'
       and not exists (select 1 from public.occupied_ranges(v_res.property_id, v_res.id) r(stay)
                        where r.stay && daterange(v_res.check_in, v_res.check_out, '[)')) then
      begin
        update public.reservations
           set status = 'confirmada', confirmed_at = now(), hold_expires_at = null,
               cancellation_reason = null, cancelled_at = null
         where id = v_res.id;
        return jsonb_build_object('ok', true, 'outcome', 'late_confirmed');
      exception when exclusion_violation then
        null; -- alguien tomó las fechas en el último instante: sigue abajo
      end;
    end if;
    insert into public.payment_incidents (payment_id, reservation_id, kind)
    values (v_pay.id, v_res.id, 'late_approval_unavailable');
    update public.reservations set needs_refund = true, refund_reason = 'pago_tardio_sin_fechas' where id = v_res.id;
    return jsonb_build_object('ok', false, 'outcome', 'needs_refund');
  end if;

  return jsonb_build_object('ok', false, 'outcome', 'unexpected_status', 'reservation_status', v_res.status);
end;
$$;

-- ─── Estado público de una reserva (/reserva/:code) ──────────────────────
-- Solo con el código largo (128 bits). Sin email, teléfono ni datos del
-- huésped.
create function public.public_booking_status(p_public_code text)
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
           'total_clp', r.total_clp
         )
    from public.reservations r
    join public.properties p on p.id = r.property_id
   where p_public_code ~ '^[0-9a-f]{32}$'
     and r.public_code = p_public_code;
$$;

-- ─── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.setting_int(text, integer) from public, anon, authenticated;
revoke execute on function public.published_property_id(text) from public, anon, authenticated;
revoke execute on function public.property_sync_fresh(uuid, integer) from public, anon, authenticated;
revoke execute on function public.current_legal_document(public.legal_document_kind) from public, anon, authenticated;
revoke execute on function public.create_booking_hold(text, date, date, integer, text, text, text, text, jsonb, text, integer) from public, anon, authenticated;
revoke execute on function public.assert_hold_chargeable(uuid) from public, anon, authenticated;
revoke execute on function public.cancel_booking_hold(uuid, text) from public, anon, authenticated;
revoke execute on function public.attach_payment(uuid, public.payment_provider, text, integer) from public, anon, authenticated;
revoke execute on function public.confirm_payment(public.payment_provider, text, text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.public_booking_status(text) from public;

grant execute on function public.published_property_id(text) to service_role;
grant execute on function public.create_booking_hold(text, date, date, integer, text, text, text, text, jsonb, text, integer) to service_role;
grant execute on function public.assert_hold_chargeable(uuid) to service_role;
grant execute on function public.cancel_booking_hold(uuid, text) to service_role;
grant execute on function public.attach_payment(uuid, public.payment_provider, text, integer) to service_role;
grant execute on function public.confirm_payment(public.payment_provider, text, text, integer, jsonb) to service_role;
grant execute on function public.public_booking_status(text) to anon, authenticated;
