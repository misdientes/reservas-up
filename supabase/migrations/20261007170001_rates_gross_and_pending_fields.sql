-- Sesión 4: ajustes del esquema antes de cargar los datos reales.

-- ─── Tarifas al público CON IVA incluido ─────────────────────────────────
-- Decisión de René (Sesión 4): un precio como $40.000 con IVA no tiene un
-- neto entero exacto (33.613 → 39.999; 33.614 → 40.001). Se guarda el
-- precio que paga el huésped y en cada reserva el servidor calcula
-- neto = round(total / 1,19) e IVA = total − neto, como en una boleta.
-- Además funciona igual si una propiedad resulta no afecta a IVA.
-- Las tablas están vacías: renombrar no pierde datos.
alter table public.rate_groups rename column base_nightly_net_clp to base_nightly_gross_clp;
alter table public.rate_groups rename column weekend_nightly_net_clp to weekend_nightly_gross_clp;
alter table public.rate_groups rename column cleaning_fee_net_clp to cleaning_fee_gross_clp;
alter table public.rate_groups rename column extra_guest_net_clp to extra_guest_gross_clp;
alter table public.rate_seasons rename column nightly_net_clp to nightly_gross_clp;
alter table public.rate_seasons rename column weekend_nightly_net_clp to weekend_nightly_gross_clp;

comment on column public.rate_groups.base_nightly_gross_clp is 'Precio por noche CON IVA incluido (CLP).';
comment on column public.rate_groups.weekend_nightly_gross_clp is 'Precio por noche de fin de semana CON IVA; null = igual al base.';
comment on column public.rate_groups.cleaning_fee_gross_clp is 'Aseo por estadía CON IVA (CLP).';
comment on column public.rate_groups.extra_guest_gross_clp is 'Cargo por huésped extra por noche CON IVA (CLP).';
comment on column public.rate_seasons.nightly_gross_clp is 'Precio por noche de la temporada CON IVA (CLP).';
comment on column public.rate_seasons.weekend_nightly_gross_clp is 'Fin de semana de la temporada CON IVA; null = igual al de la temporada.';

-- ─── Noches de fin de semana, configurables por grupo ────────────────────
-- Día ISO de la NOCHE (la fecha en que empieza): 1 = lunes … 7 = domingo.
-- Por defecto viernes (5) y sábado (6).
alter table public.rate_groups
  add column weekend_nights smallint[] not null default '{5,6}'
    check (weekend_nights <@ array[1,2,3,4,5,6,7]::smallint[]);

comment on column public.rate_groups.weekend_nights is
  'Noches con tarifa de fin de semana (día ISO de la fecha de la noche: 1=lunes … 7=domingo). Por defecto {5,6} = viernes y sábado.';

comment on column public.rate_seasons.min_nights is
  'Mínimo de noches de la temporada. Regla (Sesión 7): se aplica el MAYOR entre este valor y properties.min_nights.';

-- ─── Datos tributarios pendientes del contador ───────────────────────────
-- null = pendiente. El motor de precios (Sesión 7) no cotizará una
-- propiedad con datos tributarios pendientes.
alter table public.owners alter column vat_applies drop not null;
alter table public.owners alter column vat_applies drop default;
comment on column public.owners.vat_applies is 'true/false; null = pendiente de definir con el contador.';

alter table public.properties alter column management_model drop not null;
alter table public.properties alter column management_model drop default;
comment on column public.properties.management_model is 'null = pendiente de definir con el contador (Santiago: subarriendo o administración con comisión).';

-- ─── Ficha de la propiedad: sin valores inventados ───────────────────────
-- Si René no entrega el dato, queda null en vez de un valor por defecto
-- que parecería real. Antes de publicar (Sesión 12) se exigirá completarlos.
alter table public.properties alter column max_guests drop not null;
alter table public.properties alter column max_guests drop default;
alter table public.properties alter column bedrooms drop not null;
alter table public.properties alter column bedrooms drop default;
alter table public.properties alter column beds drop not null;
alter table public.properties alter column beds drop default;
alter table public.properties alter column bathrooms drop not null;
alter table public.properties alter column bathrooms drop default;
alter table public.properties alter column check_in_time drop not null;
alter table public.properties alter column check_in_time drop default;
alter table public.properties alter column check_out_time drop not null;
alter table public.properties alter column check_out_time drop default;

-- ─── Tipo de propiedad y llegada autónoma ────────────────────────────────
-- A futuro habrá cabañas en La Huayca (Región de Tarapacá). address ya es
-- text libre sin límite: admite direcciones rurales ("km X camino a…").
create type public.property_type as enum ('departamento', 'cabana', 'casa');

alter table public.properties
  add column property_type public.property_type not null default 'departamento',
  -- Llegada autónoma (cerradura inteligente, sin entrega de llaves en persona).
  add column self_check_in boolean not null default true;

-- La vista pública suma ambos campos al final (create or replace solo
-- permite agregar columnas al final). Mantiene sus opciones y permisos.
create or replace view public.public_properties
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
       p.min_nights,
       p.property_type,
       p.self_check_in
  from public.properties p
 where p.status = 'publicada';
