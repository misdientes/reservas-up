# CLAUDE.md — Sitio de Reservas Directas (Inmobiliaria UP)

> Contexto permanente del proyecto para Claude Code. Léelo completo al inicio de cada sesión.
> Si una instrucción de la sesión contradice este archivo, pregunta antes de actuar.

## 1. Qué es este proyecto

Sitio web de **reservas directas con pago inmediato** para propiedades de arriendo por noche.

- **Hoy:** 3 propiedades.
  - 2 departamentos en Iquique. Dueña: Inmobiliaria UP SpA. **Comparten el mismo grupo de tarifa.**
  - 1 departamento en Santiago. Dueño: René (persona natural). Administrado por UP SpA. El modelo tributario está por definir (subarriendo o administración con comisión), así que el sistema debe soportar ambos.
- **Mañana:** marketplace local para Iquique y la Región de Tarapacá, con múltiples propietarios y administradores. **El modelo de datos es multipropietario desde el día 1.**
- **Operación:** un encargado (check-in, aseo) y cerradura inteligente (marca por definir; los códigos de acceso son manuales por ahora).
- **Canales:** Airbnb (y quizás Booking) para captar huéspedes; el sitio propio para retenerlos y recibir reservas directas.
- **Prioridad del dueño:** **máxima autoadministración**. Todo lo operativo se edita desde el panel, sin tocar código.
- **Idioma:** español (Chile). Inglés en el futuro, así que no escribas textos de interfaz directamente en los componentes: centralízalos.

## 2. Stack (no cambiar sin aprobación)

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + **TypeScript** + Tailwind CSS + React Router |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions, pg_cron |
| Esquema de la base | **Migraciones versionadas con Supabase CLI** (`supabase/migrations`). Nunca cambiar el esquema a mano en el dashboard. |
| Hosting | Cloudflare Pages (despliegue automático desde GitHub) |
| Email | Resend (o Brevo) |
| Pagos | **Desacoplados del proveedor** (ver sección 5). Candidatos: MercadoPago, TUU, Flow. |
| Presupuesto | Mínimo. No agregar servicios pagados sin preguntar. |

## 3. Convenciones

- **Moneda:** pesos chilenos (CLP), **enteros, sin decimales**. Nunca usar números de punto flotante para dinero.
- **IVA:** 19%. Los precios de tarifa se guardan **CON IVA incluido** (precio final al huésped). El neto y el IVA se **EXTRAEN** del total al cotizar y emitir documentos; **nunca se suma IVA sobre un precio guardado**. Para propietarios sin IVA (`vat_applies = false`), el precio guardado es el total sin IVA. Columnas: `*_gross_clp` en `rate_groups` y `rate_seasons` (decisión de la Sesión 4: por ejemplo $40.000 no tiene un neto entero exacto). Los `*_net_clp` de `reservations` y `tax_documents` son el desglose extraído, no precios de tarifa. El arriendo amoblado de la SpA está afecto a IVA, con la rebaja del 11% anual del avalúo fiscal, proporcional a las noches. El cálculo exacto se valida con el contador: déjalo parametrizable por propietario.
- **Precios en el sitio público (decisión de René, Sesión 7):** el público ve **solo precios finales** ("$40.000 / noche", "Total $X"). **Nunca** las palabras "IVA", "neto" ni "impuesto" en tarjetas, ficha, barra de reserva, WhatsApp ni metadatos; se verifica con `grep` sobre `src/` y `dist/`. El desglose neto/IVA/rebaja vive solo en `internal_tax_breakdown` (admin). Un IVA pendiente del contador (`vat_applies = null`) **no bloquea la cotización**: Santiago se cotiza igual que Iquique; solo el desglose interno queda `pending`.
- **Motor de precios único:** todo precio sale de `pricing_core` en la base (vía `quote_stay`, `public_price_from`/`price_from_clp` e `internal_tax_breakdown`). Nunca calcular precios en el navegador (los fixtures de desarrollo son la única excepción y no existen en producción). Reglas: [docs/precios.md](docs/precios.md).
- **Fechas:** zona horaria `America/Santiago`. Una estadía es el intervalo **[check_in, check_out)**: el día de salida queda libre para la siguiente llegada.
- **Precios:** **siempre se calculan en el servidor**. Nunca confiar en un monto que venga del navegador.
- **Seguridad:** Row Level Security activado en **todas** las tablas. Las llaves secretas (service role, pagos) **solo** en Edge Functions o variables de entorno del servidor, nunca en el frontend.
- **Permisos en migraciones (obligatorio en cada tabla nueva):** el proyecto Supabase tiene **desactivada la exposición automática de tablas** y **activado el RLS automático**. Por eso cada migración que crea una tabla debe incluir, en el mismo archivo:
  1. `alter table ... enable row level security;`
  2. `GRANT` explícitos por rol con mínimo privilegio (por ejemplo `grant select ... to anon` solo si el público debe leerla; nunca `insert/update/delete` a `anon` salvo que se justifique). Sin `GRANT`, la API no ve la tabla aunque exista una política.
  3. Las políticas RLS de cada operación permitida.
  Referencia: `supabase/migrations/*_app_settings.sql`.
- **Datos parciales para un rol:** se exponen con **vistas de columnas fijas** (`security_invoker = false`, `security_barrier = true`, filtro de estado/rol en el `WHERE`) y `GRANT select` solo sobre la vista. Nunca dar `GRANT` a `anon` sobre una tabla base con columnas sensibles. Una columna nueva solo se expone si se agrega explícitamente a la vista. Detalle en [docs/modelo-datos.md](docs/modelo-datos.md#permisos-por-rol).
- **Funciones nuevas:** `set search_path = ''`, nombres calificados y `revoke execute ... from public` (Supabase da `execute` a todos por defecto); luego `grant execute` solo a quien la necesite.
- **Supabase CLI:** instalado como dependencia de desarrollo; usar siempre `npx supabase ...`. Antes de `db push`, ejecutar `db push --dry-run`.
- **Toda escritura de datos (insert/update/delete) ejecutada con `db query` debe verificarse con un conteo posterior.** Un comando sin error no garantiza que los cambios se hayan guardado (en la Sesión 2 un bloque `begin; … commit;` enviado por `db query` no se guardó y no mostró error).
- **Roles:** `admin` (René), `encargado` (operación, sin ver precios ni finanzas), `propietario` (futuro: ve solo lo suyo), público (solo lo publicado).
- **Código:** componentes pequeños, nombres en inglés en el código y textos en español en la interfaz. Comentarios en español explicando el *porqué*.
- **Cada sesión termina** con commit, despliegue verificado y una línea agregada a `BITACORA.md`.

## 4. REGLAS ANTI-DOBLE-RESERVA (no negociables)

El riesgo #1 del proyecto es vender las mismas noches dos veces, por ejemplo una reserva directa y otra de Airbnb. Ninguna sesión puede debilitar estas reglas:

1. **Restricción en la base de datos:** es imposible insertar dos ocupaciones solapadas (reserva confirmada, reserva en proceso de pago no vencida o bloqueo) para la misma propiedad. Se implementa con una restricción de exclusión sobre rangos de fechas (`btree_gist` + `daterange`), **no** solo con validaciones en el frontend.
2. **Bloqueo temporal (hold):** al iniciar el pago, las fechas quedan bloqueadas 15–20 minutos. Si el pago no se confirma, el bloqueo expira y se libera automáticamente.
3. **Revalidación antes de cobrar:** justo antes de crear el cobro, volver a importar el iCal de Airbnb para esa propiedad y verificar la disponibilidad.
4. **Importación iCal frecuente:** cada 10–15 minutos por propiedad.
5. **Anticipación mínima** para reservas directas, configurable por propiedad (por defecto 24 horas).
6. **Protocolo de conflicto:** si se detecta un solapamiento después de un pago, la reserva queda en estado `conflicto`, se avisa de inmediato a René y se dispara el reembolso según la política.
7. **Pruebas obligatorias:** toda sesión que toque reservas, calendario o pagos debe incluir pruebas que intenten forzar una doble reserva, y deben fallar.

**Cómo se cumplen (Sesión 8, detalle en [docs/ical.md](docs/ical.md)):**
- **Definición única de "noche ocupada":** `active_occupancies` / `occupied_ranges`. Calendario público, motor de precios, choques iCal y exportación la usan; nunca escribir otro filtro de ocupación (`occupancy_consistency.sql` lo vigila).
- **Regla 3:** `syncProperty(property_id)` (Edge Function `ical-import`, cuerpo `{property_id}`) revalida a demanda; el checkout (Sesión 9) la llama antes de cobrar y además NO cobra un hold con un choque abierto de tipo `hold`.
- **Regla 4:** job `ical-import` cada 10 minutos (pg_cron → pg_net → Edge Function con secreto compartido).
- **Seguridad de la importación:** una fuente caída o un archivo inválido no modifica nada; liberar un bloqueo exige que el UID falte en dos importaciones exitosas seguidas.
- **Regla 6:** un choque con una reserva pagada la pasa a `conflicto` (tipo `reserva`); con un hold queda registrado (`hold`); con otro bloqueo es `cubierto` (sin alarma).

## 5. Pagos: arquitectura desacoplada

- Interfaz única `PaymentProvider` (crear cobro, verificar aviso de pago, reembolsar) con un adaptador por proveedor (MercadoPago, TUU, Flow).
- El proveedor activo se elige por configuración, no cambiando código.
- La confirmación de una reserva **solo** ocurre cuando llega el aviso de pago verificado del proveedor (webhook), nunca por la redirección del navegador.
- Los avisos de pago deben poder procesarse varias veces sin duplicar efectos (idempotencia).
- Preparado para marketplace: la reserva registra el propietario, el administrador y la comisión, aunque hoy no se divida el pago.

## 6. Modelo de datos (resumen)

`owners` (persona natural o empresa, RUT, régimen) · `managers` (administrador, comisión) · `properties` (pertenece a un owner y opcionalmente a un manager) · `property_photos` · `rate_groups` (los 2 departamentos de Iquique comparten uno) · `rate_seasons` · `calendar_occupancies` (tabla única de noches ocupadas: reservas, holds, bloqueos manuales e iCal, con la restricción de exclusión; las de reservas las mantiene un trigger, nunca se escriben a mano) · `calendar_conflicts` (eventos externos rechazados) · `external_calendars` (iCal) · `guests` · `reservations` (estados: `hold`, `confirmada`, `cancelada`, `completada`, `conflicto`) · `payments` · `tax_documents` · `cleaning_tasks` · `access_codes` · `message_templates` · `coupons` · `app_users` + roles · `legal_documents` (términos y políticas versionados; la reserva guarda qué versión aceptó el huésped).

Detalle, diagrama y ciclo de vida: [docs/modelo-datos.md](docs/modelo-datos.md). Pruebas (todas deben dar OK, sin datos residuales): `npx supabase db query --linked -f supabase/tests/<archivo>.sql` para `anti_double_booking`, `role_permissions`, `pricing`, `ical_sync`, `occupancy_consistency`, `checkout`, `multi_owner`, `manual_payments`, `email_outbox` y `gateway`, además de `npm test` y (con la pila local) `npm run test:checkout`, `node scripts/test-emails.mjs` y `node scripts/test-gateway.mjs`. Precios: [docs/precios.md](docs/precios.md). Checkout y pagos: [docs/checkout.md](docs/checkout.md). Correos: [docs/emails.md](docs/emails.md). Alta de propiedad y cambio de dueño (`change_property_owner`): [docs/modelo-datos.md](docs/modelo-datos.md#varias-propiedades-y-varios-dueños-sesión-9b).

**Entorno local (Sesión 9):** Supabase en Docker (`npx supabase start`; `db reset` **solo** local, aplica `supabase/seed.sql` con datos de ejemplo y `environment = 'local'`), `npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt` y `npm run dev:localdb`. El proveedor de pago `mock` y la pasarela de prueba solo existen ahí (doble candado: Edge Function + trigger; la página no entra al build de producción). La función `mock-gateway` nunca se despliega.

## 7. Datos personales

Ley 21.719: recolectar solo lo necesario, registrar el consentimiento con fecha y versión de la política, no exponer datos de huéspedes al rol `encargado` más allá de lo operativo (nombre, fechas, cantidad de personas).

## 8. Estructura de carpetas

```
/src
  /components   UI reutilizable
  /pages        rutas públicas
  /admin        panel (admin y encargado)
  /lib          cliente Supabase, utilidades, textos (i18n)
  /types        tipos TypeScript
/supabase
  /migrations   esquema versionado
  /functions    Edge Functions (precios, pagos, iCal, emails)
/docs           decisiones y documentación
BITACORA.md     una línea por sesión
```

## 9. Plan de la Fase 1 (17 sesiones)

1. Base del proyecto · 2. Modelo de datos · 3. Permisos · 4. Datos reales · 5. Inicio y listado · 6. Detalle y calendario · 7. Motor de precios · 8. Sincronización iCal · 9. Checkout y hold · 10. Pagos · 11. Emails automáticos · 12. Panel: propiedades · 13. Panel: tarifas y calendario · 14. Panel del encargado · 15. Cancelaciones · 16. Pruebas y legal · 17. Lanzamiento.

**Regla:** no avanzar a la sesión siguiente sin cumplir el criterio de aceptación de la actual.

## 10. Identidad visual (Costa y Pampa)

- **Fuente de verdad:** [docs/diseno/tokens.json](docs/diseno/tokens.json) (colores, tipografía, espaciado, radios) y [docs/diseno/guia-diseno.md](docs/diseno/guia-diseno.md) (principios, voz, uso de cada token, accesibilidad). Si algo no está ahí, se pregunta antes de inventarlo.
- **Solo tokens:** toda interfaz usa exclusivamente esos tokens, expuestos como variables CSS y en el tema de Tailwind. Ningún color, tamaño de letra, espaciado ni radio suelto en los componentes.
- **Bordes de controles** (inputs, selects, botones secundarios) con `border-control` (cumple 3:1). `line` es solo decorativa.
- **Plugin frontend-design:** se usa respetando esta identidad; no propone otra estética, paleta ni tipografías.
