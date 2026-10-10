# Estado del proyecto

Última actualización: 2026-10-10 (Sesión 12 en local).

Sitio: https://reservas-up.pages.dev · Repositorio: `misdientes/reservas-up` (privado) · Supabase: `ygsckeyfewlcitrwbywf`.

## Sesiones

| # | Sesión | Estado |
|---|---|---|
| 1 | Base del proyecto | ✅ Local → GitHub → Cloudflare Pages → Supabase |
| 2 | Modelo de datos | ✅ 20 tablas, restricción anti-doble-reserva, job de holds |
| 3 | Permisos | ✅ Vistas por rol, Storage, admin cargado, registro público cerrado |
| 4 | Datos reales | ✅ 2 owners, 1 manager, 2 grupos de tarifa (con IVA), 3 propiedades en borrador |
| 5 | Inicio y listado | ✅ Diseño Costa y Pampa (solo tokens), buscador con parámetros en la URL, destinos desde los datos, estado vacío, WhatsApp editable, Open Graph. Lighthouse celular 94/100/100/100, escritorio 98/100/100/100 |
| 6 | Detalle y calendario | ✅ Ficha con galería y visor, calendario accesible con teclado (reglas en `docs/calendario.md`), URL sincronizada, disponibilidad fresca antes de WhatsApp, 404 para borradores. `npm test` 46/46. Lighthouse ficha (fixtures) celular 92/100/100/100, escritorio 100/100/100/100 |
| 7 | Motor de precios | ✅ Motor único en la base (`pricing_core` → `quote_stay`, "desde" en `public_properties`, `internal_tax_breakdown` solo admin). Público sin "IVA"; Santiago cotizable. SQL `pricing` 58/58. Lighthouse ficha 91/100/100/100 y 100/100/100/100 |
| 8 | Sincronización iCal | ✅ Definición única de ocupación; importación cada 10 min (pg_cron → pg_net → Edge Function con secreto) con "fuente caída no libera" y confirmación doble; choques reserva/hold/cubierto; exportación sin bucles ni datos personales; `sync_health`. Prueba real con Google Calendar: bloqueó y liberó. SQL `ical_sync` 37/37 y `occupancy_consistency` 7/7 |
| 9 | Checkout y hold | ✅ `/reservar/:slug` (resumen sin impuestos, cancelación con fecha concreta, datos mínimos, factura opcional con RUT validado, aceptación versionada, Turnstile, "Ir a pagar $X"), `create-booking` en el orden obligatorio, hold de 20 min, `confirm_payment` idempotente (aprobación tardía, monto alterado, duplicado), `/reserva/:code`, borradores legales. Proveedor `mock` solo local (doble candado). Producción en modo WhatsApp: `create-booking` → "pagos no disponibles". SQL `checkout` 43/43 (local y producción), integración HTTP 20/20 con concurrencia real. Lighthouse `/reservar` 91/100/100/100. Turnstile configurado (Pausa B): clave pública en Cloudflare Pages y secreta en Supabase; el widget carga en el dominio de producción. Detalle en `docs/checkout.md` |
| 9b | Preparación multi-propiedad | ✅ Migración `multi_owner` en producción (SQL 303/303 sin datos residuales; inicio con el texto nuevo). Dueño/tarifa coherentes (FK compuesta); `change_property_owner` solo admin con historial (`property_owner_changes`, nota) y conteo de reservas futuras del dueño anterior; desglose tributario congelado una vez al confirmar (`tax_breakdown_core` como única fuente, sobre `total_clp`); textos genéricos ("Tu próxima estadía, reservada directo.", "alojamientos", "norte y centro de Chile"). SQL `multi_owner` 38/38. Procedimientos en `docs/modelo-datos.md` |
| 10a | Pagos manuales y parciales | ✅ En producción (migración `manual_payments`, SQL 370/370 sin datos residuales, `create-booking` v5 idéntica al repositorio, `/admin` con login; modo `whatsapp`, medios globales sin pasarela, ninguna cuenta de cobro cargada). Transferencia y link TUU (por WhatsApp); abono = max(30 %, 1.ª noche), plazo 12 h, saldo 48 h antes, 100 % si el saldo vencería dentro del plazo; todo por propiedad con valores globales; "esperando pago" = hold manual (misma definición de ocupación); `register_manual_payment` idempotente y `release_manual_hold` (solo admin); `payment_accounts`; código corto `UP-XXXXX`; candado `booking_disabled`; `/admin` con enlace mágico. SQL 370/370 (`manual_payments` 66), HTTP 27/27, vitest 129/129, Lighthouse `/reservar` y `/reserva` 100/100 (A11y/BP). Detalle en `docs/checkout.md` |
| 11 (Parte A de 10b+11) | Correos transaccionales | ✅ En producción (migración `email_outbox`, job `email-worker` activo: responde 503 `email_not_configured` sin tocar la cola hasta configurar Resend; cola vacía). Bandeja de salida con clave de evento única, encolado en la misma transacción (triggers), worker `email-worker` (pg_cron cada minuto) con Resend, reintentos con backoff y recuperación de atascados; 5 correos al huésped + código de acceso + 5 al admin; plantillas globales con override por propiedad; `property_arrival_info` y código de acceso por reserva en `/admin`. SQL `email_outbox` 50/50 (incluye antigüedad: alertas > 24 h y correos al huésped que ya no aplican se omiten; sin transporte el worker no reclama), integración de correos 19/19. Detalle en `docs/emails.md` |
| 10b | Pasarela TUU | ✅ En producción (migración `gateway_tuu`; `create-booking` v6, `payment-webhook` v5 y `pay-online` v1 desplegadas por nombre; 0 cuentas `mock`, `gateway` fuera de los medios, modo `whatsapp`; SQL 452/452 en producción sin datos residuales). Adaptador TUU con credenciales por cuenta (`gateway_secret_name`, prefijos `TUU_`/`GATEWAY_`), abono/total/saldo por pasarela con monto del servidor, webhook que autentica (cuenta por `x_account_id` + firma HMAC en tiempo constante) antes de escribir, rechazo que mantiene el hold, `pay-online` para saldo y reintento. **Prueba real en el sandbox de TUU:** abono $45.000 + saldo $46.000 con callbacks reales → pagada. SQL `gateway` 32/32, HTTP 20/20. Detalle en `docs/checkout.md` |
| 12 | Panel: propiedades, fotos, dueños y cuentas | ✅ en local, ⏳ producción. `/admin` con secciones (Pagos y llegadas · Propiedades · Dueños · Cuentas · Cambios); ficha por secciones con concurrencia optimista; fotos procesadas en el navegador (sin EXIF/GPS, ≤ 2400 px, WebP, HEIC avisado); publicar con requisitos validados en el servidor; slug fijo desde la primera publicación; cambio de dueño solo por función; historial sin valores; `_headers` noindex/no-store en `/admin`. SQL `admin_panel` 62/62, fotos en navegador real 6/6. Guía: `docs/panel.md` |
| 13–17 | — | Pendientes |

## Bloqueos y pendientes abiertos

| Pendiente | Quién | Bloquea |
|---|---|---|
| Ficha de las 3 propiedades: nombre y slug definitivos, descripción, capacidad, comuna, dirección, avalúo, amenidades, horarios (`privado/datos-reales.md`) | René | Publicar propiedades |
| Fotos (procedimiento en `docs/fotos.md`) | René | Publicar propiedades |
| Razón social exacta de UP SpA | René | Documentos tributarios |
| IVA y modelo tributario de Santiago (`vat_applies`, `management_model`) | Contador | Desglose interno de Santiago (`tax_status = pending`); ya NO bloquea la cotización |
| Rebaja del avalúo: hoy "precio fijo" provisorio; confirmar con el contador (preguntas en `docs/precios.md`) | Contador | Boletas (desglose interno) |
| Temporadas (el motor ya las soporta) | René | Precios de temporada |
| URLs iCal de Airbnb y Booking de cada propiedad, y pegar nuestra URL de exportación en cada canal (pasos en `docs/ical.md`) | René | Sincronización real con los canales |
| Proveedor de pago real y sus claves (`PAYMENT_PROVIDER`). Turnstile e `IP_HASH_SECRET` ya están listos | René + Sesión 10 | Activar el modo `online` |
| Revisar con abogado los borradores legales (Términos con la cláusula de retracto, Privacidad según la Ley 21.719, Cancelación) y completar los [COMPLETAR] (RUT, domicilio, email, tribunales) | René + abogado | Lanzamiento |
| `public/og-image.png` todavía dice "Despierta frente al Pacífico": rehacerla con el texto nuevo | — | Vista previa al compartir |
| Borradores legales dicen "departamentos amoblados": generalizar en la versión 2 (revisión con abogado) | René + abogado | Lanzamiento |
| Datos bancarios reales de la cuenta de cobro: completar `privado/datos-pago.md` (nunca en git ni en el chat) | René | Transferencias en producción |
| Quién cobra según `management_model` (cuenta de UP o del dueño) | René + contador | Asignar `payment_account_id` por propiedad |
| Probar el enlace mágico real de `/admin` con tu correo (URL de redirección ya configurada) | René | Confirmar el login en producción |
| Secretos `SITE_URL` y `ALLOWED_ORIGINS` de las Edge Functions (hoy faltan: `create-booking` responde 503 a todo, lo que es seguro mientras el modo sea `whatsapp`) | René, al activar `online` | Reservas en línea |
| Correos: dominio propio + verificación DNS en Resend + API key (`RESEND_API_KEY`, con `--env-file` desde `privado/`) + `email_from_address` y `admin_email` + Resend como SMTP de Supabase Auth (pasos en `docs/emails.md`) | René | Que los correos salgan en producción |
| Pasarela TUU en producción: contrato con TUU, `x_account_id` y clave de producción (secreto `TUU_SECRET_…` con `--env-file` desde `privado/`), cargar la cuenta y agregar `gateway` a los medios permitidos cuando René decida | René | Pago con tarjeta |
| **S16:** la ficha pública bajó a 89 en rendimiento (Lighthouse) con fotos reales; revisar la carga de fotos (tamaños responsivos `srcset`/`sizes`, `loading="lazy"` fuera de la primera pantalla) | Sesión 16 | Rendimiento |
| Accesibilidad: el enlace del logo tiene un `aria-label` que no coincide con el texto visible (Lighthouse `label-content-name-mismatch`) | — | Sesión 16 |
| Foto de hero editable desde `app_settings` (`docs/fotos.md`) | — | Cuando haya fotos |
| Tamaño del JavaScript (~580 kB, sobre todo la librería de Supabase) | — | Optimización futura |

## Configuración editable sin código (`app_settings`, públicas)

| Clave | Para qué |
|---|---|
| `site_name` | Nombre del sitio |
| `whatsapp_number` | Número del enlace de WhatsApp (solo dígitos con código de país) |
| `whatsapp_message` | Mensaje con que se abre la conversación |
| `booking_mode` | `whatsapp` (consultar; producción hoy) u `online` (reservar y pagar). Ver `docs/checkout.md` |

Privadas, con valor por propiedad opcional (Sesión 10a): `deposit_percent` (30), `deposit_min_nights` (1), `manual_payment_window_hours` (12), `balance_due_hours_before_checkin` (48), `allowed_payment_methods` (`bank_transfer,payment_link`).
| `cancellation_free_days` | Días antes de la llegada con reembolso (5) |
| `cancellation_refund_percent` | Porcentaje de reembolso hasta ese día (100) |

Privada: `hold_minutes` (20), duración del hold mientras se paga.

## Cómo verificar

```
npm run dev                                                        # sitio local (datos reales)
# En .env.local: VITE_USE_FIXTURES=true para ver 3 propiedades de ejemplo (solo desarrollo)
npx supabase db query --linked -f supabase/tests/anti_double_booking.sql   # 22 casos
npx supabase db query --linked -f supabase/tests/role_permissions.sql      # 98 casos
npx supabase db query --linked -f supabase/tests/pricing.sql               # 58 casos
npx supabase db query --linked -f supabase/tests/ical_sync.sql             # 37 casos
npx supabase db query --linked -f supabase/tests/occupancy_consistency.sql # 7 casos
npx supabase db query --linked -f supabase/tests/checkout.sql              # 43 casos
npx supabase db query --linked -f supabase/tests/multi_owner.sql           # 38 casos
npx supabase db query --linked -f supabase/tests/manual_payments.sql       # 66 casos
npm test                                                           # 125 pruebas (fechas, calendario, precios, iCal, RUT, checkout)
# Checkout local con Docker (docs/checkout.md): npx supabase start · functions serve · npm run dev:localdb · npm run test:checkout
npm run build:fixtures && npm run preview:fixtures                  # build local con datos de ejemplo
npx supabase migration list                                        # local = remoto
node scripts/capture.mjs <url> <ancho> <salida.png>                # captura + errores de consola
```

Documentación: [CLAUDE.md](CLAUDE.md) · [docs/modelo-datos.md](docs/modelo-datos.md) · [docs/datos-reales.md](docs/datos-reales.md) · [docs/fotos.md](docs/fotos.md) · [docs/calendario.md](docs/calendario.md) · [docs/precios.md](docs/precios.md) · [docs/ical.md](docs/ical.md) · [docs/checkout.md](docs/checkout.md) · [docs/diseno/](docs/diseno/) · [docs/capturas/](docs/capturas/) · [BITACORA.md](BITACORA.md).
