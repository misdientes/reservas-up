-- Sesión 10b (Parte B de 10b+11): pasarela TUU Pago Online.
-- Credenciales POR CUENTA de cobro (payment_accounts.gateway_secret_name =
-- nombre del secreto de Supabase con la clave; gateway_account_id = el
-- x_account_id de TUU, que no es secreto). Pagos parciales por pasarela:
-- abono, total o saldo; el monto siempre lo calcula el servidor.
-- Nota: el valor 'tuu' del enum se agrega aquí y NO se usa como literal en
-- esta misma migración (Postgres no lo permite dentro de la transacción).

alter type public.payment_provider add value if not exists 'tuu';

alter table public.payment_accounts
  add column gateway_account_id  text check (gateway_account_id is null or length(gateway_account_id) between 1 and 80),
  add column gateway_environment text check (gateway_environment in ('integration', 'production'));

-- El webhook identifica la cuenta por x_account_id ANTES de tocar la base.
create unique index payment_accounts_gateway_account_key on public.payment_accounts (gateway_account_id) where gateway_account_id is not null;

-- ─── Hold por pasarela: ahora también con abono ──────────────────────────
-- (create_booking_hold de la 10a exigía el total con pasarela.) Se exige
-- además que la cuenta de la propiedad tenga la pasarela configurada.
create or replace function public.gateway_ready(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.is_active and a.provider is not null and a.gateway_secret_name is not null
                          and (a.provider::text = 'mock' or (a.gateway_account_id is not null and a.gateway_environment is not null))
                     from public.payment_accounts a where a.id = p_account_id), false);
$$;

do $$
declare
  v_def text;
begin
  -- Mismo cuerpo que la 10a con dos cambios acotados (ver comentarios).
  select pg_get_functiondef('public.create_booking_hold(text, date, date, integer, text, text, text, text, jsonb, text, integer, text, text)'::regprocedure)
    into v_def;
  v_def := replace(v_def,
    $o$  if p_payment_plan = 'deposit' and (not v_manual or (v_plan ->> 'requires_full')::boolean) then$o$,
    $n$  if p_payment_plan = 'deposit' and (v_plan ->> 'requires_full')::boolean then$n$);
  v_def := replace(v_def,
    $o$  if v_method = 'bank_transfer' and v_prop.payment_account_id is null then$o$,
    $n$  if v_method = 'gateway' and not public.gateway_ready(v_prop.payment_account_id) then
    return jsonb_build_object('ok', false, 'reason', 'gateway_not_configured');
  end if;
  if v_method = 'bank_transfer' and v_prop.payment_account_id is null then$n$);
  if v_def not like '%gateway_not_configured%' or v_def like '%not v_manual or%' then
    raise exception 'create_booking_hold no tiene el cuerpo esperado: revisar la migración';
  end if;
  execute v_def;
end;
$$;

-- ─── Crear un cobro por pasarela (monto del servidor) ────────────────────
-- hold: abono o total según el plan elegido; confirmada: saldo.
-- Un cobro pendiente vence a los 30 min (queda 'anulado' = abandonado) y
-- entonces se permite uno nuevo. Máximo 5 intentos por hora por reserva.
create function public.create_gateway_payment(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_acc public.payment_accounts%rowtype;
  v_amount integer;
  v_installment public.payment_installment;
  v_pay_id uuid;
  v_ref text;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (public.payment_policy(v_res.property_id) -> 'allowed_payment_methods') ? 'gateway' then
    return jsonb_build_object('ok', false, 'reason', 'method_not_allowed');
  end if;
  if not public.gateway_ready(v_res.payment_account_id) then
    return jsonb_build_object('ok', false, 'reason', 'gateway_not_configured');
  end if;
  select * into v_acc from public.payment_accounts where id = v_res.payment_account_id;

  if v_res.status = 'hold' and v_res.hold_expires_at > now() and v_res.amount_paid = 0 then
    v_amount := case when v_res.payment_plan = 'deposit' then coalesce(v_res.deposit_required_clp, v_res.total_clp) else v_res.total_clp end;
    v_installment := case when v_amount >= v_res.total_clp then 'full' else 'deposit' end;
  elsif v_res.status = 'confirmada' and v_res.balance_due > 0 and not v_res.needs_refund then
    v_amount := v_res.balance_due;
    v_installment := 'balance';
  else
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_pay');
  end if;

  -- Cobros pendientes de más de 30 min: abandonados.
  update public.payments
     set status = 'anulado', note = coalesce(note, 'vencido sin aviso de la pasarela (30 min)')
   where reservation_id = v_res.id and method = 'gateway' and status = 'pendiente' and created_at < now() - interval '30 minutes';
  if exists (select 1 from public.payments where reservation_id = v_res.id and method = 'gateway' and status = 'pendiente') then
    return jsonb_build_object('ok', false, 'reason', 'payment_in_progress');
  end if;
  if (select count(*) from public.payments
       where reservation_id = v_res.id and method = 'gateway' and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  -- x_reference: TUU acepta como máximo 26 caracteres (verificado en su
  -- sandbox): 24 hex aleatorios, únicos por proveedor (unique index).
  loop
    v_ref := encode(extensions.gen_random_bytes(12), 'hex');
    exit when not exists (select 1 from public.payments where provider = v_acc.provider and provider_payment_id = v_ref);
  end loop;
  insert into public.payments (reservation_id, provider, provider_payment_id, method, kind, installment, status, amount_clp, payment_account_id)
  values (v_res.id, v_acc.provider, v_ref, 'gateway', 'cobro', v_installment, 'pendiente', v_amount, v_acc.id)
  returning id into v_pay_id;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'reference', v_ref,
    'amount_clp', v_amount,
    'installment', v_installment,
    'public_code', v_res.public_code,
    'code', v_res.code,
    'contact_name', v_res.contact_name,
    'contact_email', v_res.contact_email,
    'contact_phone', v_res.contact_phone,
    'account', jsonb_build_object('id', v_acc.id, 'provider', v_acc.provider, 'gateway_account_id', v_acc.gateway_account_id,
                                  'gateway_environment', v_acc.gateway_environment, 'gateway_secret_name', v_acc.gateway_secret_name)
  );
end;
$$;

-- Cuenta por x_account_id (el webhook la busca SIN escribir nada).
create function public.gateway_account_by_external_id(p_gateway_account_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'provider', a.provider, 'gateway_secret_name', a.gateway_secret_name)
    from public.payment_accounts a
   where a.gateway_account_id = p_gateway_account_id and a.is_active;
$$;

-- Pago por su referencia (solo después de validar la firma).
create function public.gateway_payment_for_account(p_reference text, p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'provider', p.provider, 'amount_clp', p.amount_clp, 'status', p.status)
    from public.payments p
   where p.provider_payment_id = p_reference and p.payment_account_id = p_account_id and p.method = 'gateway';
$$;

-- Aviso de pasarela con firma válida pero referencia desconocida.
create function public.record_unknown_gateway_payment(p_provider text, p_reference text, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payment_incidents (kind, detail)
  values ('unknown_payment', jsonb_build_object('provider', p_provider, 'provider_payment_id', p_reference) || coalesce(p_detail, '{}'::jsonb));
$$;

-- ─── confirm_payment con montos parciales ────────────────────────────────
-- El monto del aviso debe ser el ESPERADO DE ESE PAGO (abono, total o saldo).
-- rejected: se registra y el hold se mantiene hasta su vencimiento (decisión
-- de René, 10b): el huésped puede reintentar. abandoned: libera el hold.
-- Un cobro que vencimos por 30 min ('anulado') y luego llega aprobado se
-- procesa igual: el dinero recibido manda.
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

  if not (v_pay.status = 'pendiente' or (v_pay.status = 'anulado' and p_status = 'approved')) then
    return jsonb_build_object('ok', true, 'outcome', 'already_processed', 'payment_status', v_pay.status);
  end if;

  select * into v_res from public.reservations where id = v_pay.reservation_id for update;

  if p_status = 'rejected' then
    update public.payments set status = 'rechazado', raw_payload = p_payload where id = v_pay.id;
    return jsonb_build_object('ok', true, 'outcome', 'rejected');
  end if;

  if p_status = 'abandoned' then
    update public.payments set status = 'anulado', raw_payload = p_payload where id = v_pay.id;
    if v_res.status = 'hold' then
      update public.reservations
         set status = 'cancelada', cancellation_reason = 'pago_abandonado', cancelled_at = now()
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

  -- Monto distinto al esperado de ESTE pago: no se confirma.
  if p_amount_clp is distinct from v_pay.amount_clp then
    insert into public.payment_incidents (payment_id, reservation_id, kind, detail)
    values (v_pay.id, v_res.id, 'amount_mismatch', jsonb_build_object('received_clp', p_amount_clp, 'expected_clp', v_pay.amount_clp));
    update public.reservations set needs_refund = true, refund_reason = 'monto_distinto' where id = v_res.id;
    if v_res.status = 'hold' then
      update public.reservations
         set status = 'cancelada', cancellation_reason = 'monto_distinto', cancelled_at = now()
       where id = v_res.id;
    end if;
    return jsonb_build_object('ok', false, 'outcome', 'amount_mismatch');
  end if;

  -- Saldo de una reserva confirmada.
  if v_res.status in ('confirmada', 'completada') then
    if p_amount_clp <= v_res.balance_due and not v_res.needs_refund then
      update public.reservations set amount_paid = amount_paid + p_amount_clp where id = v_res.id;
      return jsonb_build_object('ok', true, 'outcome', 'balance_paid');
    end if;
    insert into public.payment_incidents (payment_id, reservation_id, kind, detail)
    values (v_pay.id, v_res.id, 'duplicate_payment', null);
    update public.reservations set needs_refund = true, refund_reason = 'pago_duplicado' where id = v_res.id;
    return jsonb_build_object('ok', false, 'outcome', 'duplicate_payment');
  end if;

  if v_res.status = 'conflicto' then
    insert into public.payment_incidents (payment_id, reservation_id, kind, detail) values (v_pay.id, v_res.id, 'duplicate_payment', null);
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

  -- Hold vigente (o vencido aún sin liberar) → confirmada, misma ocupación.
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

-- ─── Estado público: ¿puede pagar en línea? ──────────────────────────────
-- Agrega payment.can_pay_online (saldo, o reintento de un hold por pasarela
-- vigente) sin exponer nada de la cuenta.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.public_booking_status(text)'::regprocedure) into v_def;
  v_def := replace(v_def,
    $o$             'expires_at', case when r.status = 'hold' then r.hold_expires_at end,$o$,
    $n$             'expires_at', case when r.status = 'hold' then r.hold_expires_at end,
             'can_pay_online', due.pay_now > 0
                               and (r.status = 'confirmada' or (r.status = 'hold' and r.payment_mode = 'gateway' and r.hold_expires_at > now()))
                               and (public.payment_policy(r.property_id) -> 'allowed_payment_methods') ? 'gateway'
                               and public.gateway_ready(r.payment_account_id),$n$);
  if v_def not like '%can_pay_online%' then
    raise exception 'public_booking_status no tiene el cuerpo esperado: revisar la migración';
  end if;
  execute v_def;
end;
$$;

-- ─── Permisos ────────────────────────────────────────────────────────────
revoke execute on function public.gateway_ready(uuid) from public, anon, authenticated;
revoke execute on function public.create_gateway_payment(uuid) from public, anon, authenticated;
grant execute on function public.create_gateway_payment(uuid) to service_role;
revoke execute on function public.gateway_account_by_external_id(text) from public, anon, authenticated;
grant execute on function public.gateway_account_by_external_id(text) to service_role;
revoke execute on function public.gateway_payment_for_account(text, uuid) from public, anon, authenticated;
grant execute on function public.gateway_payment_for_account(text, uuid) to service_role;
revoke execute on function public.record_unknown_gateway_payment(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_unknown_gateway_payment(text, text, jsonb) to service_role;
