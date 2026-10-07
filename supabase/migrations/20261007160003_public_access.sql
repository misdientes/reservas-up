-- Sesión 3 (3/6): lo único que el público (anon) puede leer.
-- Decisión: vistas de columnas fijas, sin ningún permiso de anon sobre las
-- tablas base. Las vistas corren con los permisos de su dueño
-- (security_invoker = false) y filtran en su WHERE; security_barrier evita
-- que filtros "con fuga" del cliente vean filas excluidas. Una columna
-- nueva en la tabla nunca queda expuesta sola: hay que agregarla aquí.

-- ─── Propiedades publicadas ──────────────────────────────────────────────
-- NUNCA: dirección exacta, avalúo, datos tributarios, owner ni manager.
create view public.public_properties
with (security_invoker = false, security_barrier = true)
as
select p.id,
       p.slug,
       p.name,
       p.description,
       p.city,
       p.region,
       p.neighborhood,
       p.max_guests,
       p.bedrooms,
       p.beds,
       p.bathrooms,
       p.amenities,
       p.house_rules,
       p.check_in_time,
       p.check_out_time,
       p.min_nights
  from public.properties p
 where p.status = 'publicada';

-- ─── Fotos de propiedades publicadas ─────────────────────────────────────
create view public.public_property_photos
with (security_invoker = false, security_barrier = true)
as
select ph.id,
       ph.property_id,
       ph.storage_path,
       ph.alt_text,
       ph.sort_order,
       ph.is_cover
  from public.property_photos ph
  join public.properties p on p.id = ph.property_id
 where p.status = 'publicada';

-- ─── Documentos legales publicados ───────────────────────────────────────
create view public.public_legal_documents
with (security_invoker = false, security_barrier = true)
as
select d.id,
       d.kind,
       d.version,
       d.title,
       d.content,
       d.published_at
  from public.legal_documents d
 where d.published_at is not null
   and d.published_at <= now();

revoke all on public.public_properties, public.public_property_photos, public.public_legal_documents
  from public, anon, authenticated;
grant select on public.public_properties, public.public_property_photos, public.public_legal_documents
  to anon, authenticated;

-- ─── Disponibilidad pública ──────────────────────────────────────────────
-- Devuelve SOLO rangos de noches ocupadas [start_date, end_date) de una
-- propiedad publicada. Los rangos contiguos se unen (range_agg) para que no
-- se pueda deducir cuántas reservas hay, de qué tipo ni de qué canal.
-- Ventana máxima de 18 meses para acotar el costo de la consulta.
create function public.get_property_availability(p_slug text, p_from date, p_to date)
returns table (start_date date, end_date date)
language sql
stable
security definer
set search_path = ''
as $$
  with prop as (
    select id
      from public.properties
     where slug = p_slug
       and status = 'publicada'
  ),
  win as (
    select daterange(p_from, least(p_to, p_from + 548), '[)') as w
     where p_from is not null and p_to is not null and p_to > p_from
  ),
  merged as (
    select range_agg(o.stay * win.w) as m
      from public.calendar_occupancies o, prop, win
     where o.property_id = prop.id
       and o.status = 'active'
       and o.stay && win.w
  )
  select lower(r), upper(r)
    from merged, unnest(merged.m) as r
   order by 1;
$$;

revoke execute on function public.get_property_availability(text, date, date) from public;
grant execute on function public.get_property_availability(text, date, date) to anon, authenticated;
