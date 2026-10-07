-- Sesión 3 (6/6): cierre de permisos sobrantes y perfil del administrador.

-- Función de trigger de la Sesión 1: no tiene sentido que un cliente la ejecute.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- rls_auto_enable (de Supabase, dueño postgres) es la función del event
-- trigger "ensure_rls". Postgres no revisa EXECUTE al disparar un event
-- trigger, así que revocarlo no desactiva el RLS automático (probado en la
-- Sesión 3 creando una tabla dentro de una transacción revertida).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Perfil admin de René. El usuario ya existe en Supabase Auth (creado a mano,
-- con su contraseña solo allí). Se busca por email; sin contraseñas aquí.
insert into public.app_users (id, role, full_name)
select u.id, 'admin', 'René Gil Osorio'
  from auth.users u
 where lower(u.email) = 'misdientes@gmail.com'
on conflict (id) do nothing;

-- Un seed silencioso no debe pasar por bueno: debe quedar exactamente un admin activo.
do $$
begin
  if (select count(*) from public.app_users where role = 'admin' and is_active) <> 1 then
    raise exception 'Se esperaba exactamente 1 admin activo después del seed';
  end if;
end;
$$;
