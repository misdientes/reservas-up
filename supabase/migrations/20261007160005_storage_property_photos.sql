-- Sesión 3 (5/6): bucket de fotos de propiedades.
-- PÚBLICO (decisión de René): lectura por URL pública para caché/CDN, SEO
-- de imágenes y vista previa al compartir enlaces. Las fotos de propiedades
-- en borrador no se consideran sensibles. La escritura es solo del admin.
-- Convención de rutas: <property_id>/<archivo>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos',
  'property-photos',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

create policy property_photos_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'property-photos' and public.is_admin());

create policy property_photos_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'property-photos' and public.is_admin())
  with check (bucket_id = 'property-photos' and public.is_admin());

create policy property_photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'property-photos' and public.is_admin());

-- El panel necesita listar los archivos del bucket; el público los lee por
-- URL pública, que no pasa por estas políticas.
create policy property_photos_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'property-photos' and public.is_admin());
