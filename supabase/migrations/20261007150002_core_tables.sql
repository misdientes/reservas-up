-- Sesión 2 (2/5): propietarios, propiedades, tarifas, huéspedes, documentos
-- legales, cupones, plantillas y usuarios.
-- Patrón (CLAUDE.md §3): RLS activado + revoke a anon/authenticated. Los
-- permisos y políticas por rol se diseñan en la Sesión 3; hasta entonces
-- ninguna de estas tablas es accesible desde el navegador.
-- Dinero: enteros en CLP (sufijo _clp). Tasas: numeric exacto, nunca float.

-- ─── owners ──────────────────────────────────────────────────────────────
create table public.owners (
  id                  uuid primary key default gen_random_uuid(),
  kind                public.owner_kind not null,
  legal_name          text not null,
  rut                 text not null unique,
  email               text,
  phone               text,
  -- Parámetros tributarios por propietario: el cálculo exacto se valida con
  -- el contador, por eso son datos y no constantes en el código.
  vat_applies         boolean not null default true,
  apply_avaluo_rebate boolean not null default false,
  avaluo_rebate_rate  numeric(5,4) not null default 0.11
                      check (avaluo_rebate_rate between 0 and 1),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─── managers ────────────────────────────────────────────────────────────
create table public.managers (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  rut                     text unique,
  email                   text,
  phone                   text,
  default_commission_rate numeric(5,4) not null default 0
                          check (default_commission_rate between 0 and 1),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ─── rate_groups ─────────────────────────────────────────────────────────
-- Varias propiedades pueden compartir tarifa (los 2 departamentos de Iquique).
create table public.rate_groups (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references public.owners (id) on delete restrict,
  name                    text not null,
  base_nightly_net_clp    integer not null check (base_nightly_net_clp >= 0),
  weekend_nightly_net_clp integer check (weekend_nightly_net_clp >= 0),
  cleaning_fee_net_clp    integer not null default 0 check (cleaning_fee_net_clp >= 0),
  included_guests         integer not null default 2 check (included_guests >= 1),
  extra_guest_net_clp     integer not null default 0 check (extra_guest_net_clp >= 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ─── rate_seasons ────────────────────────────────────────────────────────
create table public.rate_seasons (
  id                      uuid primary key default gen_random_uuid(),
  rate_group_id           uuid not null references public.rate_groups (id) on delete cascade,
  name                    text not null,
  dates                   daterange not null
                          check (not isempty(dates) and lower(dates) is not null and upper(dates) is not null),
  nightly_net_clp         integer not null check (nightly_net_clp >= 0),
  weekend_nightly_net_clp integer check (weekend_nightly_net_clp >= 0),
  min_nights              integer check (min_nights >= 1),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Temporadas solapadas en un mismo grupo harían ambiguo el precio de una noche.
  constraint rate_seasons_no_overlap
    exclude using gist (rate_group_id with =, dates with &&)
);

-- ─── properties ──────────────────────────────────────────────────────────
create table public.properties (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.owners (id) on delete restrict,
  manager_id         uuid references public.managers (id) on delete restrict,
  rate_group_id      uuid references public.rate_groups (id) on delete restrict,
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name               text not null,
  description        text,
  city               text not null,
  region             text,
  address            text,
  max_guests         integer not null default 2 check (max_guests >= 1),
  bedrooms           integer not null default 1 check (bedrooms >= 0),
  beds               integer not null default 1 check (beds >= 0),
  bathrooms          integer not null default 1 check (bathrooms >= 0),
  check_in_time      time not null default '15:00',
  check_out_time     time not null default '11:00',
  min_nights         integer not null default 1 check (min_nights >= 1),
  -- Anticipación mínima para reservas directas (CLAUDE.md §4.5).
  min_advance_hours  integer not null default 24 check (min_advance_hours >= 0),
  status             public.property_status not null default 'borrador',
  management_model   public.management_model not null default 'directo',
  -- Rebaja del 11% del avalúo fiscal, proporcional a las noches. Si
  -- avaluo_rebate_rate es null se usa la del propietario.
  avaluo_fiscal_clp  bigint check (avaluo_fiscal_clp >= 0),
  avaluo_rebate_rate numeric(5,4) check (avaluo_rebate_rate between 0 and 1),
  timezone           text not null default 'America/Santiago',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index properties_owner_id_idx on public.properties (owner_id);
create index properties_rate_group_id_idx on public.properties (rate_group_id);

-- ─── property_photos ─────────────────────────────────────────────────────
create table public.property_photos (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  storage_path text not null,
  alt_text     text,
  sort_order   integer not null default 0,
  is_cover     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index property_photos_property_id_idx on public.property_photos (property_id, sort_order);
-- Solo una foto de portada por propiedad.
create unique index property_photos_one_cover_idx on public.property_photos (property_id) where is_cover;

-- ─── guests ──────────────────────────────────────────────────────────────
-- Ley 21.719: solo lo necesario para la reserva y la operación.
create table public.guests (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text not null,
  phone           text,
  document_number text,
  country         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index guests_email_idx on public.guests (lower(email));

-- ─── legal_documents ─────────────────────────────────────────────────────
-- Términos y políticas versionados: la reserva guarda la versión aceptada.
create table public.legal_documents (
  id           uuid primary key default gen_random_uuid(),
  kind         public.legal_document_kind not null,
  version      text not null,
  title        text not null,
  content      text not null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kind, version)
);

-- ─── coupons ─────────────────────────────────────────────────────────────
create table public.coupons (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  discount_type   public.discount_type not null,
  percent_off     numeric(5,4) check (percent_off > 0 and percent_off <= 1),
  amount_off_clp  integer check (amount_off_clp > 0),
  property_id     uuid references public.properties (id) on delete cascade,
  valid_from      date,
  valid_to        date,
  max_uses        integer check (max_uses >= 1),
  used_count      integer not null default 0 check (used_count >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint coupons_discount_matches_type check (
    (discount_type = 'porcentaje' and percent_off is not null and amount_off_clp is null)
    or (discount_type = 'monto' and amount_off_clp is not null and percent_off is null)
  ),
  constraint coupons_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

-- Los códigos no distinguen mayúsculas: "VERANO" y "verano" son el mismo cupón.
create unique index coupons_code_idx on public.coupons (lower(code));

-- ─── message_templates ───────────────────────────────────────────────────
create table public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  channel    public.message_channel not null default 'email',
  language   text not null default 'es',
  subject    text,
  body       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, channel, language)
);

-- ─── app_users ───────────────────────────────────────────────────────────
-- Perfil y rol de cada usuario de Supabase Auth.
create table public.app_users (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.app_role not null,
  full_name  text not null,
  -- Un propietario solo verá lo suyo (Sesión 3).
  owner_id   uuid references public.owners (id) on delete restrict,
  manager_id uuid references public.managers (id) on delete restrict,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_owner_role check (role <> 'propietario' or owner_id is not null)
);

-- ─── RLS, permisos y updated_at para todas las tablas de este archivo ────
do $$
declare
  t text;
begin
  foreach t in array array[
    'owners', 'managers', 'rate_groups', 'rate_seasons', 'properties', 'property_photos',
    'guests', 'legal_documents', 'coupons', 'message_templates', 'app_users'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;
