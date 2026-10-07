# Fotos de propiedades

Hasta que exista el panel (Sesión 12), las fotos se suben a mano en Supabase y se registran con SQL.

## Convención

- Bucket: `property-photos` (**público**: cualquiera con la URL ve la foto; escribir solo puede el admin).
- Ruta: `<property_id>/<nn>-<descripcion>.<ext>`, por ejemplo `6329f9ea-9843-4e69-af0c-b78a3cefdcd4/01-living.jpg`.
  - `nn` (01, 02, …) define el orden.
  - `descripcion` en minúsculas, sin tildes ni espacios (usar guiones).
- Formatos: JPEG, PNG, WebP o AVIF. Máximo 10 MB por archivo (recomendado: menos de 1 MB, lado mayor ~2000 px).
- Una sola foto de portada por propiedad (`is_cover = true`).

| Propiedad | property_id |
|---|---|
| iquique-1 | `6329f9ea-9843-4e69-af0c-b78a3cefdcd4` |
| iquique-2 | `2b4fb90c-3a49-4ebd-a787-b73e66e45ba3` |
| santiago-1 | `78cde6bc-5f2b-4832-903a-6844874947ba` |

## Procedimiento

1. **Subir** — Supabase → Storage → `property-photos` → *Create folder* con el `property_id` → entrar a la carpeta → *Upload files*.
2. **Registrar** cada foto en `property_photos` (Claude lo genera y ejecuta):
   ```sql
   insert into public.property_photos (property_id, storage_path, alt_text, sort_order, is_cover)
   values
     ('<property_id>', '<property_id>/01-living.jpg', 'Living con vista al mar', 1, true),
     ('<property_id>', '<property_id>/02-dormitorio.jpg', 'Dormitorio principal', 2, false);
   ```
   `storage_path` es la ruta dentro del bucket (sin el nombre del bucket). `alt_text` describe la foto para accesibilidad y SEO.
3. **Verificar con conteo** (CLAUDE.md §3):
   ```sql
   select p.slug, count(ph.*) as fotos, count(*) filter (where ph.is_cover) as portadas
     from public.properties p
     left join public.property_photos ph on ph.property_id = p.id
    group by p.slug order by p.slug;
   ```
4. URL pública de una foto: `https://ygsckeyfewlcitrwbywf.supabase.co/storage/v1/object/public/property-photos/<storage_path>`.

Las fotos de propiedades en borrador **no se consideran sensibles** (el bucket es público). La vista `public_property_photos` solo lista las de propiedades publicadas.
