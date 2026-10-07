-- Sesión 2 (4/5): pagos, documentos tributarios, aseo y códigos de acceso.

-- ─── payments ────────────────────────────────────────────────────────────
-- Desacoplado del proveedor (CLAUDE.md §5). La unicidad por proveedor +
-- id externo es la base de la idempotencia de los webhooks (Sesión 10).
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  reservation_id      uuid not null references public.reservations (id) on delete restrict,
  provider            public.payment_provider not null,
  provider_payment_id text,
  kind                public.payment_kind not null default 'cobro',
  status              public.payment_status not null default 'pendiente',
  amount_clp          integer not null check (amount_clp > 0),
  raw_payload         jsonb,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create index payments_reservation_id_idx on public.payments (reservation_id, status);

-- ─── tax_documents ───────────────────────────────────────────────────────
create table public.tax_documents (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id) on delete restrict,
  owner_id       uuid not null references public.owners (id) on delete restrict,
  doc_type       public.tax_document_type not null,
  status         public.tax_document_status not null default 'borrador',
  folio          text,
  issued_at      timestamptz,
  net_clp        integer not null check (net_clp >= 0),
  vat_clp        integer not null default 0 check (vat_clp >= 0),
  total_clp      integer not null check (total_clp >= 0),
  pdf_path       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index tax_documents_folio_idx
  on public.tax_documents (owner_id, doc_type, folio) where folio is not null;
create index tax_documents_reservation_id_idx on public.tax_documents (reservation_id);

-- ─── cleaning_tasks ──────────────────────────────────────────────────────
create table public.cleaning_tasks (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties (id) on delete restrict,
  reservation_id uuid references public.reservations (id) on delete set null,
  scheduled_for  date not null,
  status         public.cleaning_status not null default 'pendiente',
  assigned_to    uuid references public.app_users (id) on delete set null,
  notes          text,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index cleaning_tasks_schedule_idx on public.cleaning_tasks (scheduled_for, property_id);

-- ─── access_codes ────────────────────────────────────────────────────────
-- Códigos de la cerradura inteligente (manuales por ahora).
create table public.access_codes (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties (id) on delete restrict,
  reservation_id uuid references public.reservations (id) on delete set null,
  code           text not null,
  valid_from     timestamptz not null,
  valid_to       timestamptz not null,
  status         public.access_code_status not null default 'pendiente',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint access_codes_valid_range check (valid_to > valid_from)
);

create index access_codes_reservation_id_idx on public.access_codes (reservation_id);

-- ─── RLS, permisos y updated_at ──────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['payments', 'tax_documents', 'cleaning_tasks', 'access_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;
