# Estado del proyecto

Última actualización: 2026-10-07 (Sesión 5, parcial).

Sitio: https://reservas-up.pages.dev · Repositorio: `misdientes/reservas-up` (privado) · Supabase: `ygsckeyfewlcitrwbywf`.

## Sesiones

| # | Sesión | Estado |
|---|---|---|
| 1 | Base del proyecto | ✅ Local → GitHub → Cloudflare Pages → Supabase |
| 2 | Modelo de datos | ✅ 20 tablas, restricción anti-doble-reserva, job de holds |
| 3 | Permisos | ✅ Vistas por rol, Storage, admin cargado, registro público cerrado |
| 4 | Datos reales | ✅ 2 owners, 1 manager, 2 grupos de tarifa (con IVA), 3 propiedades en borrador |
| 5 | Inicio y listado | 🟡 **Parcial**: corrección de IVA en CLAUDE.md/docs y clave `whatsapp_number`. La página de inicio espera los archivos de diseño |
| 6–17 | — | Pendientes |

## Bloqueos y pendientes abiertos

| Pendiente | Quién | Bloquea |
|---|---|---|
| Archivos de diseño "Costa y Pampa": `docs/diseno/tokens.json`, `docs/diseno/guia-diseno.md` y CLAUDE.md §10 (Identidad visual) | René | Sesión 5 (página de inicio) |
| Plugin `frontend-design` de Claude Code (no está instalado en la sesión) | René | Sesión 5 (pedido en las restricciones) |
| Número de WhatsApp público (`app_settings.whatsapp_number`, hoy vacío) | René | Enlace de WhatsApp en el sitio |
| Ficha de las 3 propiedades: nombre y slug definitivos, descripción, capacidad, comuna, dirección, avalúo, amenidades, horarios (`privado/datos-reales.md`) | René | Publicar propiedades |
| Razón social exacta de UP SpA | René | Documentos tributarios |
| IVA y modelo tributario de Santiago (`vat_applies`, `management_model`) | Contador | Cotizar Santiago (Sesión 7) |
| Rebaja del avalúo: traspasar al huésped o mantener precio publicado | Contador | Sesión 7 |
| Temporadas y URLs iCal de Airbnb/Booking | René | Sesiones 7 y 8 |
| Fotos (procedimiento en `docs/fotos.md`) | René | Publicar propiedades |

## Cómo verificar

```
npm run dev                                                        # sitio local
npx supabase db query --linked -f supabase/tests/anti_double_booking.sql   # 22 casos
npx supabase db query --linked -f supabase/tests/role_permissions.sql      # 93 casos
npx supabase migration list                                        # local = remoto
```

Documentación: [CLAUDE.md](CLAUDE.md) · [docs/modelo-datos.md](docs/modelo-datos.md) · [docs/datos-reales.md](docs/datos-reales.md) · [docs/fotos.md](docs/fotos.md) · [BITACORA.md](BITACORA.md).
