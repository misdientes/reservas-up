-- Sesión 12: panel de administración (propiedades, fotos, dueños, cuentas).
-- Toda la validación vive en la base: el panel (rol authenticated + RLS de
-- admin) escribe directo en las tablas y estas reglas valen igual para
-- cualquier cliente. Las funciones security definer (publicar, cambiar de
-- dueño) corren como su dueño y por eso pueden hacer lo que el panel no
-- puede hacer con un UPDATE directo.

-- ─── Utilidades ──────────────────────────────────────────────────────────
-- ¿La sentencia viene del panel (API con el rol authenticated)?
create function public.is_api_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- RUT chileno: mismo algoritmo (módulo 11) que supabase/functions/_shared/rut.ts.
create function public.is_valid_rut(p_rut text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text := upper(regexp_replace(coalesce(p_rut, ''), '[.\s‐–—-]', '', 'g'));
  v_body text;
  v_dv text;
  v_sum integer := 0;
  v_factor integer := 2;
  v_rest integer;
begin
  if v_clean !~ '^\d{1,8}[\dK]$' then
    return false;
  end if;
  v_body := ltrim(left(v_clean, length(v_clean) - 1), '0');
  v_dv := right(v_clean, 1);
  if length(v_body) < 6 then
    return false;
  end if;
  for i in reverse length(v_body)..1 loop
    v_sum := v_sum + substr(v_body, i, 1)::integer * v_factor;
    v_factor := case when v_factor = 7 then 2 else v_factor + 1 end;
  end loop;
  v_rest := 11 - (v_sum % 11);
  return v_dv = case v_rest when 11 then '0' when 10 then 'K' else v_rest::text end;
end;
$$;

-- ─── Concurrencia optimista ──────────────────────────────────────────────
-- El panel envía en cada "Guardar" el updated_at que cargó. Si en la base
-- cambió (otro dispositivo guardó antes), se rechaza (40001) y el panel pide
-- recargar. Un cliente que no envía updated_at (funciones del servidor) no
-- se ve afectado. Siempre deja updated_at = now().
create function public.concurrency_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_api_write() and new.updated_at is distinct from old.updated_at then
    raise exception 'Esta ficha cambió en otro dispositivo. Recarga para ver la versión actual.'
      using errcode = '40001', hint = 'ficha_desactualizada';
  end if;
  -- clock_timestamp: cambia aun dentro de una misma transacción.
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

alter table public.payment_accounts alter column updated_at set default now();
-- La guardia también fija updated_at: reemplaza a los triggers anteriores,
-- que lo pisaban con now().
drop trigger properties_set_updated_at on public.properties;
drop trigger owners_set_updated_at on public.owners;

create trigger properties_concurrency_guard before update on public.properties
  for each row execute function public.concurrency_guard();
create trigger owners_concurrency_guard before update on public.owners
  for each row execute function public.concurrency_guard();
create trigger property_arrival_info_concurrency_guard before update on public.property_arrival_info
  for each row execute function public.concurrency_guard();
create trigger payment_accounts_concurrency_guard before update on public.payment_accounts
  for each row execute function public.concurrency_guard();

-- ─── Propiedades ─────────────────────────────────────────────────────────
alter table public.properties add column first_published_at timestamptz;
update public.properties set first_published_at = coalesce(first_published_at, updated_at) where status = 'publicada';

alter table public.properties
  add constraint properties_name_len check (length(trim(name)) between 2 and 100),
  add constraint properties_city_len check (length(trim(city)) between 2 and 80),
  add constraint properties_description_len check (description is null or length(description) <= 5000),
  add constraint properties_house_rules_len check (house_rules is null or length(house_rules) <= 3000),
  add constraint properties_max_guests_max check (max_guests is null or max_guests <= 30),
  add constraint properties_min_nights_max check (min_nights <= 60),
  add constraint properties_min_advance_max check (min_advance_hours <= 720);

-- Vocabulario de amenidades: evita "Wifi" / "WiFi" / "wi-fi" en la ficha.
create function public.amenity_vocabulary()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'Wifi', 'Estacionamiento', 'Cocina equipada', 'Refrigerador', 'Microondas', 'Cafetera', 'Hervidor',
    'Lavadora', 'Secadora', 'Aire acondicionado', 'Calefacción', 'Agua caliente', 'TV', 'Smart TV',
    'Ropa de cama', 'Toallas', 'Secador de pelo', 'Plancha', 'Escritorio de trabajo', 'Terraza', 'Balcón',
    'Vista al mar', 'Piscina', 'Ascensor', 'Parrilla', 'Cuna', 'Apto para mascotas', 'Acceso autónomo',
    'Detector de humo', 'Extintor', 'Botiquín'
  ];
$$;

create function public.amenity_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(translate(lower(coalesce(p, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]', '', 'g');
$$;

-- Canónica si está en el vocabulario; si no, el texto recortado.
create function public.normalize_amenities(p text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.label order by x.first_pos), '{}')
    from (
      select distinct on (public.amenity_key(t.label)) t.label, t.pos as first_pos
        from (
          select coalesce((select v from unnest(public.amenity_vocabulary()) v
                            where public.amenity_key(v) = public.amenity_key(a) limit 1), left(trim(a), 60)) as label,
                 pos
            from unnest(coalesce(p, '{}')) with ordinality u(a, pos)
           where length(trim(a)) > 0
        ) t
       order by public.amenity_key(t.label), t.pos
    ) x;
$$;

-- Reglas que el panel no puede saltarse con un UPDATE directo:
--  * slug fijo desde la primera publicación (decisión de René);
--  * owner_id solo vía change_property_owner;
--  * status y first_published_at solo vía publish/unpublish_property;
--  * amenidades normalizadas.
create function public.properties_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.amenities := public.normalize_amenities(new.amenities);
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug and old.first_published_at is not null then
      raise exception 'El slug queda fijo desde la primera publicación (los enlaces compartidos no deben romperse).'
        using errcode = '23514', hint = 'slug_fijo';
    end if;
    if public.is_api_write() then
      if new.owner_id is distinct from old.owner_id then
        raise exception 'El dueño solo se cambia con "Cambiar dueño" (change_property_owner).' using errcode = '42501', hint = 'usar_change_property_owner';
      end if;
      if new.status is distinct from old.status or new.first_published_at is distinct from old.first_published_at then
        raise exception 'La publicación se cambia con "Publicar" o "Despublicar".' using errcode = '42501', hint = 'usar_publish_property';
      end if;
    end if;
  elsif public.is_api_write() and (new.status <> 'borrador' or new.first_published_at is not null) then
    raise exception 'Una propiedad nueva nace en borrador.' using errcode = '42501', hint = 'usar_publish_property';
  end if;
  return new;
end;
$$;

create trigger properties_guard before insert or update on public.properties
  for each row execute function public.properties_guard();

-- ─── Dueños: RUT válido (la base, no solo el formulario) ────────────────
alter table public.owners add constraint owners_rut_valid check (public.is_valid_rut(rut)) not valid;
do $$
begin
  alter table public.owners validate constraint owners_rut_valid;
exception when check_violation then
  -- Un dato antiguo con RUT inválido no bloquea la migración: la regla vale
  -- para todo lo nuevo y lo editado; el panel lo marca para corregir.
  raise notice 'Hay dueños con RUT inválido: corregirlos desde el panel.';
end;
$$;

-- ─── Fotos ───────────────────────────────────────────────────────────────
alter table public.property_photos
  add constraint property_photos_alt_required check (alt_text is not null and length(trim(alt_text)) between 3 and 200) not valid,
  add constraint property_photos_path_format check (
    storage_path like property_id::text || '/%'
    and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$') not valid;
do $$
begin
  alter table public.property_photos validate constraint property_photos_alt_required;
  alter table public.property_photos validate constraint property_photos_path_format;
exception when check_violation then
  raise notice 'Hay fotos antiguas sin texto alternativo o con otra ruta: corregirlas desde el panel.';
end;
$$;

-- Propiedad publicada: nunca menos de 5 fotos ni sin portada (decisión de René).
create function public.property_photos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pid uuid := coalesce(old.property_id, new.property_id);
  v_published boolean;
begin
  select status = 'publicada' into v_published from public.properties where id = v_pid;
  if not coalesce(v_published, false) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if (select count(*) from public.property_photos where property_id = v_pid) <= 5 then
      raise exception 'La propiedad está publicada y necesita al menos 5 fotos: sube otra antes de borrar esta.'
        using errcode = '23514', hint = 'minimo_fotos';
    end if;
    if old.is_cover then
      raise exception 'Esta foto es la portada: elige otra portada antes de borrarla.' using errcode = '23514', hint = 'portada';
    end if;
  elsif tg_op = 'UPDATE' and old.is_cover and not new.is_cover then
    -- Quitar la portada solo dentro de un cambio de portada (admin_set_cover).
    if coalesce(current_setting('app.cover_change', true), '') <> 'on' then
      raise exception 'Elige otra portada en vez de quitar esta.' using errcode = '23514', hint = 'portada';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger property_photos_guard before update or delete on public.property_photos
  for each row execute function public.property_photos_guard();

-- Cambiar la portada (una transacción: quita la anterior y marca la nueva).
create function public.admin_set_cover(p_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  select property_id into v_pid from public.property_photos where id = p_photo_id;
  if v_pid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform set_config('app.cover_change', 'on', true);
  update public.property_photos set is_cover = false where property_id = v_pid and is_cover and id <> p_photo_id;
  update public.property_photos set is_cover = true where id = p_photo_id;
  perform set_config('app.cover_change', '', true);
  return jsonb_build_object('ok', true);
end;
$$;

-- Ordenar en una transacción.
create function public.admin_reorder_photos(p_property_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  update public.property_photos f
     set sort_order = x.pos
    from unnest(p_ids) with ordinality x(id, pos)
   where f.id = x.id and f.property_id = p_property_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Borrar una foto: valida (trigger) y devuelve la ruta para borrar el archivo.
create function public.admin_delete_photo(p_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  delete from public.property_photos where id = p_photo_id returning storage_path into v_path;
  if v_path is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', v_path);
exception when check_violation then
  return jsonb_build_object('ok', false, 'reason', 'blocked', 'message', sqlerrm);
end;
$$;

-- ─── Publicar / despublicar ──────────────────────────────────────────────
-- Lista de lo que falta (vacía = se puede publicar). Textos para René.
create function public.property_publish_check(p_property_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.properties%rowtype;
  i public.property_arrival_info%rowtype;
  v_missing text[] := '{}';
  v_policy jsonb;
  v_methods jsonb;
  v_today date := (now() at time zone 'America/Santiago')::date;
  v_photos integer;
  v_unpriced integer;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  select * into p from public.properties where id = p_property_id;
  if not found then
    return array['La propiedad no existe.'];
  end if;
  select * into i from public.property_arrival_info where property_id = p.id;

  select count(*) into v_photos from public.property_photos where property_id = p.id;
  if not exists (select 1 from public.property_photos where property_id = p.id and is_cover) then
    v_missing := v_missing || 'Elige una foto de portada.'::text;
  end if;
  if v_photos < 5 then
    v_missing := v_missing || format('Sube al menos 5 fotos (hay %s).', v_photos);
  end if;
  if exists (select 1 from public.property_photos where property_id = p.id and (alt_text is null or length(trim(alt_text)) < 3)) then
    v_missing := v_missing || 'Escribe el texto alternativo de todas las fotos.'::text;
  end if;
  if coalesce(length(trim(p.description)), 0) < 20 then
    v_missing := v_missing || 'Escribe la descripción (al menos 20 caracteres).'::text;
  end if;
  if p.check_in_time is null or p.check_out_time is null then
    v_missing := v_missing || 'Indica las horas de llegada y de salida.'::text;
  end if;
  if p.max_guests is null then
    v_missing := v_missing || 'Indica la capacidad (huéspedes).'::text;
  end if;
  if coalesce(length(trim(coalesce(i.exact_address, p.address))), 0) < 5 then
    v_missing := v_missing || 'Escribe la dirección exacta (privada).'::text;
  end if;
  if coalesce(length(trim(i.access_instructions)), 0) < 10 then
    v_missing := v_missing || 'Escribe las instrucciones de llegada (cómo entrar).'::text;
  end if;
  if p.rate_group_id is null then
    v_missing := v_missing || 'Asigna una tarifa.'::text;
  else
    select count(*) into v_unpriced
      from generate_series(v_today, v_today + 89, interval '1 day') g(d)
     where not exists (select 1 from public.night_price(p.rate_group_id, g.d::date) np where np.price_clp > 0);
    if v_unpriced > 0 then
      v_missing := v_missing || format('La tarifa no tiene precio para %s de las próximas 90 noches.', v_unpriced);
    end if;
  end if;

  v_policy := public.payment_policy(p.id);
  v_methods := v_policy -> 'allowed_payment_methods';
  if (v_methods ? 'bank_transfer' or v_methods ? 'payment_link')
     and not exists (select 1 from public.payment_accounts a where a.id = p.payment_account_id and a.is_active) then
    v_missing := v_missing || 'Asigna una cuenta de cobro activa (los pagos manuales la necesitan).'::text;
  end if;
  if v_methods ? 'bank_transfer' and exists (select 1 from public.payment_accounts a where a.id = p.payment_account_id
                                              and (a.account_number is null or a.bank_name is null)) then
    v_missing := v_missing || 'La cuenta de cobro no tiene datos de transferencia.'::text;
  end if;
  if v_methods ? 'gateway' and not public.gateway_ready(p.payment_account_id) then
    v_missing := v_missing || 'La pasarela de la cuenta de cobro no está configurada (o quita "Pago con tarjeta").'::text;
  end if;
  return v_missing;
end;
$$;

create function public.publish_property(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  v_missing := public.property_publish_check(p_property_id); -- valida is_admin()
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'missing', to_jsonb(v_missing));
  end if;
  update public.properties
     set status = 'publicada', first_published_at = coalesce(first_published_at, now())
   where id = p_property_id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.unpublish_property(p_property_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_future integer;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  select count(*) into v_future from public.reservations
   where property_id = p_property_id and status in ('hold', 'confirmada')
     and check_out > (now() at time zone 'America/Santiago')::date;
  if v_future > 0 and not coalesce(p_confirm, false) then
    return jsonb_build_object('ok', false, 'needs_confirmation', true, 'future_reservations', v_future);
  end if;
  -- Las reservas existentes NO se cancelan: siguen su curso.
  update public.properties set status = 'borrador' where id = p_property_id;
  return jsonb_build_object('ok', true, 'future_reservations', v_future);
end;
$$;

-- ─── Cuentas de cobro ────────────────────────────────────────────────────
alter table public.payment_accounts
  add constraint payment_accounts_secret_prefix
  check (gateway_secret_name is null or gateway_secret_name ~ '^(TUU|GATEWAY)_[A-Z0-9_]{2,60}$' or gateway_secret_name = 'MOCK_WEBHOOK_SECRET') not valid;
do $$
begin
  alter table public.payment_accounts validate constraint payment_accounts_secret_prefix;
exception when check_violation then
  raise notice 'Hay cuentas con un nombre de secreto fuera del formato: corregirlas desde el panel.';
end;
$$;

-- Lista para el panel: número enmascarado y si la pasarela está lista.
create function public.admin_payment_accounts()
returns table (
  id uuid, owner_id uuid, owner_name text, label text, provider text, bank_name text, account_type text,
  account_number_masked text, holder_name text, is_active boolean, gateway_environment text, gateway_ready boolean,
  used_by integer, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador' using errcode = '42501';
  end if;
  return query
    select a.id, a.owner_id, o.legal_name, a.label, a.provider::text, a.bank_name, a.account_type,
           case when a.account_number is null then null else '••••' || right(regexp_replace(a.account_number, '\D', '', 'g'), 4) end,
           a.holder_name, a.is_active, a.gateway_environment, public.gateway_ready(a.id),
           (select count(*)::integer from public.properties p where p.payment_account_id = a.id), a.updated_at
      from public.payment_accounts a
      join public.owners o on o.id = a.owner_id
     order by a.label;
end;
$$;

-- ─── Historial de cambios del panel ──────────────────────────────────────
create table public.admin_audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor          uuid,
  table_name     text not null,
  record_id      text,
  operation      text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  -- Solo NOMBRES de campos: nunca valores (datos bancarios, accesos, RUT).
  changed_fields text[] not null default '{}'
);

create index admin_audit_log_record_idx on public.admin_audit_log (table_name, record_id, at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy admin_audit_log_admin_select on public.admin_audit_log
  for select to authenticated using ((select public.is_admin()));

create function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_fields text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_fields
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at') and v_new -> k is distinct from v_old -> k;
    if cardinality(v_fields) = 0 then
      return new;
    end if;
  else
    v_fields := '{}';
  end if;
  insert into public.admin_audit_log (actor, table_name, record_id, operation, changed_fields)
  values ((select auth.uid()), tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'property_id', v_old ->> 'property_id'),
          tg_op, v_fields);
  return coalesce(new, old);
end;
$$;

create trigger owners_audit after insert or update or delete on public.owners for each row execute function public.audit_changes();
create trigger properties_audit after insert or update or delete on public.properties for each row execute function public.audit_changes();
create trigger property_arrival_info_audit after insert or update or delete on public.property_arrival_info for each row execute function public.audit_changes();
create trigger property_photos_audit after insert or update or delete on public.property_photos for each row execute function public.audit_changes();
create trigger payment_accounts_audit after insert or update or delete on public.payment_accounts for each row execute function public.audit_changes();
create trigger property_owner_changes_audit after insert on public.property_owner_changes for each row execute function public.audit_changes();
create trigger message_templates_audit after insert or update or delete on public.message_templates for each row execute function public.audit_changes();

-- ─── Permisos ────────────────────────────────────────────────────────────
-- Los triggers corren con el rol del panel (authenticated): necesita ejecutar
-- estas funciones auxiliares (no revelan ni modifican nada).
revoke execute on function public.is_api_write() from public, anon;
grant execute on function public.is_api_write() to authenticated;
revoke execute on function public.concurrency_guard() from public, anon, authenticated;
revoke execute on function public.properties_guard() from public, anon, authenticated;
revoke execute on function public.property_photos_guard() from public, anon, authenticated;
revoke execute on function public.audit_changes() from public, anon, authenticated;
revoke execute on function public.amenity_key(text) from public, anon;
grant execute on function public.amenity_key(text) to authenticated;
revoke execute on function public.normalize_amenities(text[]) from public, anon;
grant execute on function public.normalize_amenities(text[]) to authenticated;
revoke execute on function public.is_valid_rut(text) from public, anon;
grant execute on function public.is_valid_rut(text) to authenticated;
revoke execute on function public.amenity_vocabulary() from public, anon;
grant execute on function public.amenity_vocabulary() to authenticated;
revoke execute on function public.admin_set_cover(uuid) from public, anon;
grant execute on function public.admin_set_cover(uuid) to authenticated;
revoke execute on function public.admin_reorder_photos(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_photos(uuid, uuid[]) to authenticated;
revoke execute on function public.admin_delete_photo(uuid) from public, anon;
grant execute on function public.admin_delete_photo(uuid) to authenticated;
revoke execute on function public.property_publish_check(uuid) from public, anon;
grant execute on function public.property_publish_check(uuid) to authenticated;
revoke execute on function public.publish_property(uuid) from public, anon;
grant execute on function public.publish_property(uuid) to authenticated;
revoke execute on function public.unpublish_property(uuid, boolean) from public, anon;
grant execute on function public.unpublish_property(uuid, boolean) to authenticated;
revoke execute on function public.admin_payment_accounts() from public, anon;
grant execute on function public.admin_payment_accounts() to authenticated;
