-- Sesión 6: el calendario público necesita la anticipación mínima para no
-- ofrecer fechas que el servidor rechazaría (CLAUDE.md §4.5). No es un dato
-- sensible. create or replace view solo permite agregar columnas al final;
-- se mantienen las opciones de seguridad y los permisos de la vista.
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
       p.self_check_in,
       p.min_advance_hours
  from public.properties p
 where p.status = 'publicada';
