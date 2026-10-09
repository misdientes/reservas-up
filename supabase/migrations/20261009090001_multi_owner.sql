-- Sesión 9b: preparación multi-propiedad.
-- 1) Coherencia dueño/tarifa: una propiedad solo puede usar una tarifa de su
--    mismo dueño (restricción declarativa, sin trigger).
-- 2) Cambio de dueño seguro (change_property_owner, solo admin) con historial.
-- 3) Desglose tributario congelado en la reserva al confirmarse, con UNA sola
--    fuente de verdad (tax_breakdown_core). El sistema no decide nada
--    tributario: aplica la configuración del dueño (owners.vat_applies,
--    rebaja del avalúo) y la registra.

-- ─── 1. Coherencia dueño/tarifa ──────────────────────────────────────────
-- FK compuesta: (rate_group_id, owner_id) de la propiedad debe existir como
-- (id, owner_id) en rate_groups. Con rate_group_id nulo no se exige
-- (MATCH SIMPLE: propiedad sin tarifa). ON UPDATE RESTRICT impide además
-- cambiar el dueño de una tarifa que usan propiedades de otro dueño.
-- Al crearla, Postgres valida los datos actuales: si alguno fuera
-- incoherente, la migración falla sin cambiar nada.
alter table public.rate_groups
  add constraint rate_groups_id_owner_key unique (id, owner_id);

alter table public.properties
  add constraint properties_rate_group_same_owner
  foreign key (rate_group_id, owner_id) references public.rate_groups (id, owner_id)
  on update restrict on delete restrict;

-- ─── 2. Historial de cambios de dueño ────────────────────────────────────
create table public.property_owner_changes (
  id                     uuid primary key default gen_random_uuid(),
  property_id            uuid not null references public.properties (id) on delete cascade,
  previous_owner_id      uuid not null references public.owners (id) on delete restrict,
  new_owner_id           uuid not null references public.owners (id) on delete restrict,
  previous_rate_group_id uuid references public.rate_groups (id) on delete set null,
  new_rate_group_id      uuid references public.rate_groups (id) on delete set null,
  note                   text check (note is null or length(note) <= 500),
  changed_by             uuid,
  changed_at             timestamptz not null default now()
);

create index property_owner_changes_property_idx on public.property_owner_changes (property_id, changed_at desc);

alter table public.property_owner_changes enable row level security;
revoke all on public.property_owner_changes from public, anon, authenticated;
-- Solo lectura para el admin; se escribe únicamente vía change_property_owner.
grant select on public.property_owner_changes to authenticated;
create policy property_owner_changes_admin_select on public.property_owner_changes
  for select to authenticated using ((select public.is_admin()));

-- Cambia dueño y tarifa juntos (un solo UPDATE: la FK del punto 1 lo
-- verifica). Las reservas existentes NO cambian: congelan su owner_id al
-- crearse. Devuelve cuántas reservas futuras (hold o confirmadas, llegada
-- desde hoy en Chile) quedan con el dueño anterior, para revisarlas.
create function public.change_property_owner(
  p_property_id uuid,
  p_new_owner_id uuid,
  p_new_rate_group_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.properties%rowtype;
  v_rg_owner uuid;
  v_future integer;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede cambiar el dueño de una propiedad' using errcode = '42501';
  end if;

  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    raise exception 'La propiedad no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.owners where id = p_new_owner_id) then
    raise exception 'El dueño nuevo no existe' using errcode = 'P0002';
  end if;
  if p_new_rate_group_id is not null then
    select owner_id into v_rg_owner from public.rate_groups where id = p_new_rate_group_id;
    if not found then
      raise exception 'La tarifa no existe' using errcode = 'P0002';
    end if;
    if v_rg_owner <> p_new_owner_id then
      raise exception 'La tarifa pertenece a otro dueño' using errcode = '23503';
    end if;
  end if;

  update public.properties
     set owner_id = p_new_owner_id, rate_group_id = p_new_rate_group_id, updated_at = now()
   where id = p_property_id;

  insert into public.property_owner_changes
    (property_id, previous_owner_id, new_owner_id, previous_rate_group_id, new_rate_group_id, note, changed_by)
  values
    (p_property_id, v_prop.owner_id, p_new_owner_id, v_prop.rate_group_id, p_new_rate_group_id,
     nullif(trim(p_note), ''), (select auth.uid()));

  select count(*) into v_future
    from public.reservations r
   where r.property_id = p_property_id
     and r.owner_id = v_prop.owner_id
     and r.status in ('hold', 'confirmada')
     and r.check_in >= (now() at time zone 'America/Santiago')::date;

  return jsonb_build_object(
    'ok', true,
    'previous_owner_id', v_prop.owner_id,
    'owner_id', p_new_owner_id,
    'rate_group_id', p_new_rate_group_id,
    'future_reservations_previous_owner', v_future
  );
end;
$$;

revoke execute on function public.change_property_owner(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.change_property_owner(uuid, uuid, uuid, text) to authenticated;

-- ─── 3. Desglose tributario: una sola fuente de verdad ───────────────────
-- Calcula el desglose de un TOTAL ya conocido con la configuración ACTUAL del
-- dueño indicado. tax_status:
--   pending              → vat_applies null: sin cifras (no se inventan).
--   exempt               → vat_applies false: neto = total, IVA = 0.
--   ok                   → vat_applies true: rebaja del avalúo (precio_fijo).
--   mode_not_implemented → modo 'traspasar' (aún sin definir).
-- La usan internal_tax_breakdown (admin, cotización) y el congelamiento de la
-- reserva al confirmarse. Interna: nadie la ejecuta directamente.
create function public.tax_breakdown_core(
  p_owner_id uuid,
  p_property_id uuid,
  p_total_clp integer,
  p_nights integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner public.owners%rowtype;
  v_prop public.properties%rowtype;
  v_rate numeric;
  v_rebate integer := 0;
  v_net integer;
  v_vat integer;
begin
  select * into v_owner from public.owners where id = p_owner_id;
  select * into v_prop from public.properties where id = p_property_id;

  if v_owner.vat_applies is null then
    return jsonb_build_object('tax_status', 'pending');
  end if;

  if not v_owner.vat_applies then
    return jsonb_build_object('tax_status', 'exempt', 'net_clp', p_total_clp, 'vat_clp', 0, 'avaluo_rebate_base_clp', 0);
  end if;

  if v_owner.avaluo_rebate_mode <> 'precio_fijo' then
    return jsonb_build_object('tax_status', 'mode_not_implemented', 'avaluo_rebate_mode', v_owner.avaluo_rebate_mode);
  end if;

  -- Rebaja: 11% anual (tasa de la propiedad o del dueño) del avalúo, proporcional a las noches.
  if v_owner.apply_avaluo_rebate and v_prop.avaluo_fiscal_clp is not null then
    v_rate := coalesce(v_prop.avaluo_rebate_rate, v_owner.avaluo_rebate_rate);
    v_rebate := round(v_prop.avaluo_fiscal_clp * v_rate / 365 * p_nights)::integer;
  end if;

  select e.net_clp, e.vat_clp into v_net, v_vat from public.vat_extract(p_total_clp, v_rebate) e;
  return jsonb_build_object('tax_status', 'ok', 'avaluo_rebate_mode', v_owner.avaluo_rebate_mode,
                            'avaluo_rebate_base_clp', v_rebate, 'net_clp', v_net, 'vat_clp', v_vat);
end;
$$;

revoke execute on function public.tax_breakdown_core(uuid, uuid, integer, integer) from public, anon, authenticated, service_role;

-- Misma firma, misma salida y mismos permisos: ahora delega en el núcleo.
create or replace function public.internal_tax_breakdown(
  p_property_id uuid,
  p_check_in date,
  p_check_out date,
  p_guests integer,
  p_reservation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
  v_total integer;
  v_nights integer;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el desglose tributario' using errcode = '42501';
  end if;

  v_quote := public.pricing_core(p_property_id, p_check_in, p_check_out, p_guests, p_reservation_id);
  if not (v_quote ->> 'quotable')::boolean then
    return jsonb_build_object('quotable', false, 'reason', v_quote -> 'reason');
  end if;

  v_total := (v_quote ->> 'total_clp')::integer;
  v_nights := (v_quote ->> 'nights_count')::integer;
  return jsonb_build_object('quotable', true, 'total_clp', v_total, 'nights_count', v_nights)
         || public.tax_breakdown_core((select owner_id from public.properties where id = p_property_id),
                                      p_property_id, v_total, v_nights);
end;
$$;

-- ─── Desglose congelado en la reserva ────────────────────────────────────
alter table public.reservations
  add column tax_status    text check (tax_status in ('pending', 'exempt', 'ok', 'mode_not_implemented')),
  add column tax_snapshot  jsonb,
  add column tax_frozen_at timestamptz;

-- freeze_reservation_tax: al pasar la reserva a 'confirmada' (confirm_payment,
-- en sus ramas confirmed y late_confirmed, o una confirmación manual) se
-- guarda el desglose UNA sola vez:
--   * sobre reservations.total_clp (el total de la reserva), NUNCA sobre el
--     monto de cada pago. En la Sesión 10 habrá abono + saldo (varios pagos
--     por reserva): los pagos siguientes no recongelan;
--   * con la configuración del dueño CONGELADO en la reserva (owner_id), tal
--     como está en ese momento; cambios posteriores del dueño o de la
--     propiedad no alteran reservas ya confirmadas.
-- pending / mode_not_implemented: se registra el estado y los montos quedan
-- en 0 (no se inventan cifras). Nada de esto es visible al público.
create function public.freeze_reservation_tax()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.owners%rowtype;
  v_prop public.properties%rowtype;
  v_tax jsonb;
begin
  select * into v_owner from public.owners where id = new.owner_id;
  select * into v_prop from public.properties where id = new.property_id;
  v_tax := public.tax_breakdown_core(new.owner_id, new.property_id, new.total_clp, new.check_out - new.check_in);

  new.tax_status := v_tax ->> 'tax_status';
  new.net_total_clp := coalesce((v_tax ->> 'net_clp')::integer, 0);
  new.vat_clp := coalesce((v_tax ->> 'vat_clp')::integer, 0);
  new.avaluo_rebate_clp := coalesce((v_tax ->> 'avaluo_rebate_base_clp')::integer, 0);
  new.tax_snapshot := v_tax || jsonb_build_object(
    'total_clp', new.total_clp,
    'nights', new.check_out - new.check_in,
    'owner_id', new.owner_id,
    'vat_applies', v_owner.vat_applies,
    'apply_avaluo_rebate', v_owner.apply_avaluo_rebate,
    'avaluo_rebate_rate', coalesce(v_prop.avaluo_rebate_rate, v_owner.avaluo_rebate_rate),
    'avaluo_fiscal_clp', v_prop.avaluo_fiscal_clp
  );
  new.tax_frozen_at := now();
  return new;
end;
$$;

revoke execute on function public.freeze_reservation_tax() from public, anon, authenticated;

create trigger reservations_freeze_tax_on_update
  before update of status on public.reservations
  for each row
  when (new.status = 'confirmada' and old.status is distinct from 'confirmada' and new.tax_frozen_at is null)
  execute function public.freeze_reservation_tax();

create trigger reservations_freeze_tax_on_insert
  before insert on public.reservations
  for each row
  when (new.status = 'confirmada' and new.tax_frozen_at is null)
  execute function public.freeze_reservation_tax();
