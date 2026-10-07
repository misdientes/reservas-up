-- Sesión 1: configuración general del sitio, editable sin tocar código.
-- Patrón obligatorio (CLAUDE.md §3): RLS + GRANT explícitos + políticas.
-- El proyecto NO expone tablas automáticamente, así que sin GRANT la API
-- no puede leerla aunque exista una política.

create table public.app_settings (
  key         text primary key,
  value       text not null,
  -- Solo las filas públicas se pueden leer sin iniciar sesión.
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.app_settings is 'Configuración del sitio (clave/valor). Las filas con is_public = true son legibles por el público.';

alter table public.app_settings enable row level security;

-- Permisos de tabla: el público y los usuarios autenticados solo leen.
-- La escritura se habilitará para el rol admin en la sesión de permisos.
revoke all on table public.app_settings from anon, authenticated;
grant select on table public.app_settings to anon, authenticated;

-- RLS: aunque tengan SELECT, solo ven las filas marcadas como públicas.
create policy app_settings_public_read
  on public.app_settings
  for select
  to anon, authenticated
  using (is_public = true);

-- Mantiene updated_at al día en cada modificación.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value, is_public)
values ('site_name', 'Reservas UP', true)
on conflict (key) do nothing;
