# Sincronización iCal (Airbnb, Booking y otros)

Sesión 8. Importa los calendarios de los canales como bloqueos y exporta los nuestros para que los canales bloqueen las noches vendidas aquí. Implementa las reglas 3, 4 y 6 de CLAUDE.md §4.

| Pieza | Dónde |
|---|---|
| Lectura de `.ics`, descarga segura y generación | `supabase/functions/_shared/ical.ts` (probado con vitest: `ical.test.ts`) |
| Sincronización (todas o una propiedad: `syncProperty`) | `supabase/functions/_shared/ical-sync.ts` |
| Importación automática | Edge Function `ical-import` + job `ical-import` (pg_cron, cada 10 min, vía pg_net) |
| Exportación | Edge Function `ical-export` |
| Aplicar cambios en la base | `apply_ical_import` (SQL, probado en `supabase/tests/ical_sync.sql`) |
| Salud | vista `sync_health` (solo admin) |

## Conectar Airbnb

1. **Importar Airbnb → Reservas UP** (que el sitio bloquee lo vendido en Airbnb):
   Airbnb → **Calendario** → elige el anuncio → **Disponibilidad** → **Conectar calendarios** (o "Sincronizar calendarios") → **Exportar calendario** → copia el enlace (termina en `.ics`).
2. **Exportar Reservas UP → Airbnb** (que Airbnb bloquee lo vendido aquí):
   en la misma pantalla → **Importar calendario** → pega nuestra URL de exportación (abajo) y ponle un nombre, por ejemplo "Reservas UP".

## Conectar Booking.com

1. **Importar Booking → Reservas UP:** Extranet → **Tarifas y disponibilidad** → **Sincronizar calendarios** → **Exportar calendario** → copia el enlace.
2. **Exportar Reservas UP → Booking:** misma sección → **Importar calendario** → pega nuestra URL de exportación.

## Registrar una URL de importación (sin dejarla en git)

Las URL de importación son **secretas** (quien las tiene ve tu calendario): nunca van en git, en el chat ni en registros.

**Desde la Sesión 13 se cargan en el panel:** ficha de la propiedad → **Calendario, bloqueos e iCal** → **Agregar calendario**. La base valida la URL (`https://`, sin usuario/clave, host dentro de `ical_allowed_hosts`; trigger `external_calendars_guard`). La lista del panel la muestra **enmascarada** (`https://www.airbnb.cl/••••9876`, función `admin_external_calendars`) y el formulario nunca la vuelve a cargar completa (al editar, vacío = no cambiar). El historial registra solo que cambió `import_url`, nunca el valor. Alternativa por SQL:

```sql
insert into public.external_calendars (property_id, channel, name, import_url)
values ('<property_id>', 'airbnb', 'Airbnb', '<URL copiada de Airbnb>');
-- channel: 'airbnb', 'booking' u 'otro' (Google Calendar u otros).
```

Los `property_id` están en [docs/fotos.md](fotos.md). La Edge Function nunca escribe la URL en sus registros ni en `last_sync_error`.

## Nuestra URL de exportación

Una por calendario externo, con un token de 48 caracteres no adivinable:

```
https://ygsckeyfewlcitrwbywf.supabase.co/functions/v1/ical-export/calendar/<export_token>.ics
```

```sql
select p.slug, c.channel, c.name,
       'https://ygsckeyfewlcitrwbywf.supabase.co/functions/v1/ical-export/calendar/' || c.export_token || '.ics' as url
  from public.external_calendars c join public.properties p on p.id = c.property_id;
```

Contiene: reservas confirmadas (y completadas o en conflicto) como "Reservado", bloqueos manuales e iCal de **otros** canales como "No disponible". **No** contiene holds ni los eventos que vinieron de ese mismo canal (para evitar bucles: Airbnb nunca recibe de vuelta sus propios bloqueos). Sin datos personales. Caché de 5 minutos.

## Reglas de la importación

- **Cada 10 minutos** (job `ical-import`) y **a demanda** por propiedad (`syncProperty`, que usará el checkout para revalidar justo antes de cobrar).
- **Descarga segura:** solo `https`, solo hosts permitidos (`app_settings.ical_allowed_hosts`, hoy `airbnb.*,booking.com,google.com`; `airbnb.*` acepta airbnb.cl, .com, etc.), redirecciones validadas, 15 s de espera máxima, 2 MB máximo.
- **Fechas:** día completo tal cual (DTEND = día de salida); con hora o TZID se convierten a la fecha de Chile; eventos pasados se ignoran y todo se recorta a la ventana de 548 días.
- **Por UID:** nuevo → bloqueo; cambió de fechas → se actualiza; un UID duplicado se une en el rango que cubre ambos; `STATUS:CANCELLED` no bloquea.
- **REGLA DE SEGURIDAD — fuente caída no libera:** si la descarga falla (red, código HTTP, tiempo, tamaño) o el archivo no es un VCALENDAR válido **o tiene un solo evento que no se entiende**, no se modifica **nada**: se guarda `last_sync_status = 'error'` y `last_sync_error` (sin la URL).
- **Confirmación doble antes de liberar:** un bloqueo cuyo UID **no viene** en una importación exitosa **no se libera de inmediato**: se marca (`missing_count = 1`). Solo pasa a `released` si **también falta en la siguiente importación exitosa**. Si reaparece, se limpia la marca. Aplica igual a un calendario vacío válido. Una importación fallida entre medio no cuenta. Consecuencia: **una cancelación real tarda ~10–20 minutos más en liberarse**; es el lado seguro (nunca se vende una noche por un archivo que llegó a medias).

## Choques (el evento externo choca con una ocupación existente)

La restricción anti-doble-reserva impide guardar el bloqueo; se registra en `calendar_conflicts` (un registro abierto por UID y ocupación, aunque el import se repita cada 10 minutos):

| Tipo | Con qué choca | Qué pasa |
|---|---|---|
| `reserva` | Reserva **pagada** (confirmada) | La reserva pasa a **`conflicto`**: se vendió dos veces. Alarma a René (email: Sesión 11) y reembolso según la política (Sesiones 10 y 15). |
| `hold` | Un hold (pago en curso) | Se registra; el hold no cambia. Se reintenta en cada corrida: cuando el hold se libera, el evento se importa y el choque se cierra (`importado`). **Un hold con un choque abierto de tipo `hold` NO se puede cobrar: el checkout (Sesión 9) debe verificarlo antes de crear el pago.** |
| `cubierto` | Un bloqueo manual u otro iCal (p. ej. Airbnb y Booking bloqueando las mismas noches) | **No es conflicto**: las noches ya estaban bloqueadas. Se registra como cubierto, sin alarma. |

Los choques se cierran solos cuando el evento desaparece del canal (`evento eliminado`) o cuando por fin se puede importar (`importado`).

## Salud de la sincronización: `sync_health`

Vista solo para el admin (`select * from sync_health`):

| Columna | Qué significa |
|---|---|
| `status` | `ok` · `error` (último intento falló, aún dentro de 60 min) · **`atrasado`** (más de 60 min sin un éxito: revisar) · `pendiente` (recién creado) · `inactivo` |
| `last_success_at`, `minutes_since_success` | Última sincronización exitosa |
| `last_attempt_at`, `last_sync_status`, `last_sync_error` | Último intento y su error (sin URL) |
| `last_sync_summary` | Insertados, actualizados, sin cambios, marcados como faltantes, liberados, choques |
| `open_conflicts_reserva`, `open_conflicts_hold`, `covered_events` | Choques abiertos por tipo |

El aviso por email cuando un calendario queda `atrasado` llega en la Sesión 11 (el estado ya está listo).

En el panel (Sesión 13) el estado se explica en palabras ("Sincronizado · hace 4 min", "Error en la última sincronización · HTTP 404", "Atrasado") y los choques abiertos (`admin_calendar_conflicts`) con qué hacer en cada caso. **Copiar URL de exportación** copia la URL de cada canal.

## "Sincronizar ahora" (Sesión 13)

El botón del panel llama a la Edge Function `ical-import` con el JWT del admin (además del secreto del cron, que sigue igual):

1. `admin_claim_ical_sync(property_id)` (en la base, con el JWT del usuario): exige `is_admin()`, bloquea la fila de la propiedad (`FOR UPDATE`, dos clics simultáneos no pasan ambos), exige al menos un calendario activo y una **pausa de 60 s** por propiedad (marca `last_attempt_at`).
2. Si pasa, la importación sigue **el mismo camino que el job**: `syncProperty` → `apply_ical_import`, con su `FOR UPDATE` por calendario (no hay otro candado en el job) y sus reglas de seguridad (fuente caída no libera, confirmación doble).

Respuestas: 200 (resumen sin URLs), 401 sin sesión, 403 si no es admin, 409 sin calendarios, 429 con `Retry-After` durante la pausa. Prueba: `node scripts/test-sync-now.mjs` (pila local).

## Mantenimiento

- Job `cron-history-cleanup` (diario, 04:17 UTC): borra de `cron.job_run_details` lo de más de 7 días. Las respuestas de pg_net (`net._http_response`) se limpian solas (la extensión las conserva unas horas).
- Secreto compartido pg_cron → función: `ICAL_CRON_SECRET` (secreto de Edge Functions) = `ical_cron_secret` (Supabase Vault). Para rotarlo, generar un valor nuevo y actualizar ambos (nunca en archivos).
- Lista de hosts permitidos: `update app_settings set value = 'airbnb.*,booking.com,google.com,otro.com' where key = 'ical_allowed_hosts';`

## Definición única de "noche ocupada"

`active_occupancies` / `occupied_ranges` (Sesión 8) son la única definición: la usan el calendario público, el motor de precios, los choques y la exportación. Una ocupación activa ocupa sus noches, sea del tipo que sea; un hold vencido sigue ocupando hasta que el job lo libera. `supabase/tests/occupancy_consistency.sql` comprueba noche por noche que calendario y motor dicen lo mismo.
