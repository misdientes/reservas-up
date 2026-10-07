# Estado del proyecto

Última actualización: 2026-10-07 (Sesión 7).

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
| 8–17 | — | Pendientes |

## Bloqueos y pendientes abiertos

| Pendiente | Quién | Bloquea |
|---|---|---|
| Ficha de las 3 propiedades: nombre y slug definitivos, descripción, capacidad, comuna, dirección, avalúo, amenidades, horarios (`privado/datos-reales.md`) | René | Publicar propiedades |
| Fotos (procedimiento en `docs/fotos.md`) | René | Publicar propiedades |
| Razón social exacta de UP SpA | René | Documentos tributarios |
| IVA y modelo tributario de Santiago (`vat_applies`, `management_model`) | Contador | Desglose interno de Santiago (`tax_status = pending`); ya NO bloquea la cotización |
| Rebaja del avalúo: hoy "precio fijo" provisorio; confirmar con el contador (preguntas en `docs/precios.md`) | Contador | Boletas (desglose interno) |
| Temporadas (el motor ya las soporta) y URLs iCal de Airbnb/Booking | René | Precios de temporada y Sesión 8 |
| Botón "Reservar" con pago en la barra de la ficha (modo `book` preparado) | — | Sesión 9 |
| Foto de hero editable desde `app_settings` (`docs/fotos.md`) | — | Cuando haya fotos |
| Tamaño del JavaScript (~580 kB, sobre todo la librería de Supabase) | — | Optimización futura |

## Configuración editable sin código (`app_settings`, públicas)

| Clave | Para qué |
|---|---|
| `site_name` | Nombre del sitio |
| `whatsapp_number` | Número del enlace de WhatsApp (solo dígitos con código de país) |
| `whatsapp_message` | Mensaje con que se abre la conversación |

## Cómo verificar

```
npm run dev                                                        # sitio local (datos reales)
# En .env.local: VITE_USE_FIXTURES=true para ver 3 propiedades de ejemplo (solo desarrollo)
npx supabase db query --linked -f supabase/tests/anti_double_booking.sql   # 22 casos
npx supabase db query --linked -f supabase/tests/role_permissions.sql      # 98 casos
npx supabase db query --linked -f supabase/tests/pricing.sql               # 58 casos
npm test                                                           # 61 pruebas (fechas, calendario, precios)
npm run build:fixtures && npm run preview:fixtures                  # build local con datos de ejemplo
npx supabase migration list                                        # local = remoto
node scripts/capture.mjs <url> <ancho> <salida.png>                # captura + errores de consola
```

Documentación: [CLAUDE.md](CLAUDE.md) · [docs/modelo-datos.md](docs/modelo-datos.md) · [docs/datos-reales.md](docs/datos-reales.md) · [docs/fotos.md](docs/fotos.md) · [docs/calendario.md](docs/calendario.md) · [docs/precios.md](docs/precios.md) · [docs/diseno/](docs/diseno/) · [docs/capturas/](docs/capturas/) · [BITACORA.md](BITACORA.md).
