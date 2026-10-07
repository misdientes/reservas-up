-- Sesión 3 (1/6): campos públicos de la ficha de propiedad.

alter table public.properties
  -- Comuna o sector: se muestra al público en vez de la dirección exacta.
  add column neighborhood text,
  add column amenities    text[] not null default '{}',
  add column house_rules  text;
