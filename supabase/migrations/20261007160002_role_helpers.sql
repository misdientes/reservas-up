-- Sesión 3 (2/6): funciones auxiliares de rol para políticas y vistas.
-- SECURITY DEFINER: leen app_users aunque quien consulta no tenga permiso
-- sobre esa tabla (evita recursión de RLS). STABLE: se evalúan una vez por
-- consulta. Solo authenticated puede ejecutarlas; anon nunca tiene rol.

create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
    from public.app_users
   where id = auth.uid()
     and is_active;
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

-- Personal de operación: el encargado y también el admin.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'encargado'), false);
$$;

-- Owner del usuario con rol propietario (null para cualquier otro).
create function public.current_owner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select owner_id
    from public.app_users
   where id = auth.uid()
     and is_active
     and role = 'propietario';
$$;

revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.current_owner_id() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.current_owner_id() to authenticated;
