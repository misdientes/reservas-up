-- Sesión 2 (1/5): extensiones y tipos enumerados del modelo de datos.

-- btree_gist permite combinar "=" sobre uuid con "&&" sobre rangos en una
-- misma restricción de exclusión: es la base de la regla anti-doble-reserva.
create extension if not exists btree_gist with schema extensions;

-- pg_cron libera los holds vencidos cada minuto (una restricción no puede
-- depender de now(), así que la expiración la aplica un job).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create type public.app_role as enum ('admin', 'encargado', 'propietario');
create type public.owner_kind as enum ('persona_natural', 'empresa');
create type public.property_status as enum ('borrador', 'publicada', 'pausada');
-- Modelo tributario/comercial de la propiedad (el de René en Santiago está por definir).
create type public.management_model as enum ('directo', 'subarriendo', 'administracion_comision');

create type public.reservation_status as enum ('hold', 'confirmada', 'cancelada', 'completada', 'conflicto');
create type public.reservation_channel as enum ('directo', 'airbnb', 'booking', 'otro');

create type public.occupancy_kind as enum ('reservation', 'hold', 'manual_block', 'ical_block');
-- released = hold vencido liberado por el job; cancelled = anulada por una persona o proceso.
create type public.occupancy_status as enum ('active', 'released', 'cancelled');
create type public.calendar_channel as enum ('airbnb', 'booking', 'otro');

create type public.payment_provider as enum ('mercadopago', 'tuu', 'flow');
create type public.payment_kind as enum ('cobro', 'reembolso');
create type public.payment_status as enum ('pendiente', 'aprobado', 'rechazado', 'reembolsado', 'anulado');

create type public.tax_document_type as enum ('boleta', 'factura', 'nota_credito');
create type public.tax_document_status as enum ('borrador', 'emitido', 'anulado');

create type public.cleaning_status as enum ('pendiente', 'en_curso', 'hecha', 'cancelada');
create type public.access_code_status as enum ('pendiente', 'activo', 'revocado');
create type public.message_channel as enum ('email', 'whatsapp', 'sms');
create type public.legal_document_kind as enum ('terminos', 'privacidad', 'cancelacion');
create type public.discount_type as enum ('porcentaje', 'monto');
