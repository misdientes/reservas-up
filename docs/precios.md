# Precios

Motor de precios **único en la base de datos** (Sesión 7, migración `supabase/migrations/20261007210001_pricing_engine.sql`). Lo usan el listado ("desde"), la ficha (`quote_stay`) y, desde la Sesión 9, el checkout (`pricing_core`). El precio mostrado y el cobrado salen del mismo cálculo. Pruebas: `supabase/tests/pricing.sql` (58 casos).

## Decisiones de René (Sesión 7)

1. **El sitio público solo muestra precios finales.** "$40.000 / noche" y "Total $X". Nunca las palabras "IVA", "neto" ni "impuesto" en tarjetas, ficha, barra, mensajes de WhatsApp ni metadatos. `quote_stay` no devuelve neto ni IVA. El desglose tributario vive solo en `internal_tax_breakdown` (admin), para boletas y reportes. Se verifica con un `grep` sobre `src/` y `dist/` en cada sesión.
2. **Santiago se cotiza igual que Iquique.** Un IVA pendiente del contador (`owners.vat_applies = null`) no bloquea la cotización pública, porque el precio guardado ya es el precio final. Solo el desglose interno queda `tax_status = 'pending'`, sin cifras inventadas. (Esto reemplaza lo dicho en la Sesión 4, "el motor no cotizará una propiedad con datos tributarios pendientes", que quedó en un comentario de la migración `…170001`; las migraciones antiguas no se editan.)

## Funciones

| Función | Quién la ejecuta | Qué hace |
|---|---|---|
| `quote_stay(slug, llegada, salida, huéspedes)` | público | Cotiza una propiedad **publicada**. Devuelve solo: `quotable`, `reason`, `min_nights`, `nights[]` (fecha, tipo, temporada, precio), `nights_count`, `cleaning_clp`, `extra_guests`, `extra_guests_clp`, `total_clp`. |
| `public_price_from(slug)` | público | "Desde": menor precio por noche en los próximos 90 días. |
| `public_properties.price_from_clp` | público | El mismo "desde", para todas las tarjetas en una sola consulta. |
| `internal_tax_breakdown(property_id, llegada, salida, huéspedes, reservation_id?)` | solo admin (`is_admin()`) | Mismo total que el público + `tax_status`, `net_clp`, `vat_clp`, `avaluo_rebate_base_clp`. Funciona también con propiedades no publicadas (boletas). |
| `pricing_core(…, p_exclude_reservation_id, p_now)` | nadie desde el navegador | Núcleo del cálculo. |
| `night_price`, `vat_extract`, `price_from_by_id` | interno (`price_from_by_id` lo ejecuta el público solo a través de la vista y solo responde por publicadas) | Piezas del cálculo. |

## Reglas de tarifa

- **Precios guardados con IVA incluido** (precio final al huésped): `rate_groups.*_gross_clp`, `rate_seasons.*_gross_clp`. Nunca se suma IVA sobre un precio guardado.
- **Precio de cada noche** (solo con la fecha, `isodow`, nunca con horas ni la zona del servidor):
  1. Si la noche cae en una temporada del grupo: su tarifa de fin de semana (si la noche es de fin de semana y la temporada la tiene) o su tarifa.
  2. Si no: la tarifa de fin de semana del grupo (si aplica y existe) o la base.
  - Fin de semana = día ISO de la noche en `rate_groups.weekend_nights` (por defecto `{5,6}`: viernes y sábado).
- **Aseo:** una vez por estadía.
- **Huéspedes extra:** `(huéspedes − incluidos) × cargo por noche × noches`, si es positivo.
- **Total** = noches + aseo + huéspedes extra.
- **Mínimo de noches efectivo** = el **mayor** entre `properties.min_nights` y el `min_nights` de la temporada de la **noche de llegada**.
- **"Desde"** = menor precio de una noche (base, fin de semana o temporada) entre hoy y hoy + 89 (Chile). No considera ocupación ni huéspedes extra. Null si no hay tarifa ("Consultar precio").

## Motivos por los que no se cotiza (`reason`), en este orden

| Motivo | Cuándo | Mensaje en la ficha |
|---|---|---|
| `not_found` | Propiedad inexistente o no publicada | "Esta propiedad no está disponible." |
| `invalid_dates` | Fechas nulas, salida ≤ llegada, llegada antes de hoy (Chile) o salida después de hoy + 548 | "Revisa las fechas…" |
| `advance` | Llegada antes de la anticipación mínima (ver abajo) | "Reserva con al menos N horas de anticipación." |
| `max_guests` | Huéspedes < 1 o sobre `max_guests` | "Esta propiedad recibe hasta N huéspedes." |
| `no_rate` | La propiedad no tiene grupo de tarifa | "Aún no hay tarifa publicada…" |
| `min_nights` | Menos noches que el mínimo efectivo | "Para estas fechas la estadía mínima es de N noches." |
| `unavailable` | Alguna noche ocupada (reserva, hold, bloqueo manual o iCal) | "Esas fechas ya no están disponibles. Elige otras." |

### Anticipación mínima: misma regla en frontend y base

`pricing_core` (motivo `advance`) y `earliestCheckIn` (`src/lib/calendar/availability.ts`, calendario) usan **la misma regla**: ahora + `min_advance_hours` (instante real, así los cambios de horario no la mueven), llevado a la fecha y hora de Chile **y truncado al minuto**; si esa hora es posterior a `check_in_time`, la llegada más temprana es el día siguiente; sin hora de check-in se asume 00:00. Probado en el borde exacto en ambos lados (vitest y `pricing.sql`).

### Requisito para el checkout (Sesión 9)

`pricing_core` recibe `p_exclude_reservation_id`: al revisar `unavailable` ignora la ocupación (hold) de **esa** reserva, para poder recotizarla mientras está retenida. `quote_stay` no expone ese parámetro. Los bloqueos manuales e iCal nunca se ignoran (no tienen `reservation_id`; la guarda `p_exclude_reservation_id is null or …` evita el error de `NULL is distinct from NULL`, detectado por las pruebas en esta sesión).

## Desglose tributario interno (solo admin)

`internal_tax_breakdown` usa el total de `pricing_core` (idéntico al público) y:

| `owners.vat_applies` | `tax_status` | Neto / IVA |
|---|---|---|
| `null` (pendiente del contador) | `pending` | sin cifras |
| `false` | `exempt` | neto = total, IVA = 0 |
| `true`, modo `precio_fijo` | `ok` | ver fórmula |
| `true`, modo `traspasar` | `mode_not_implemented` | sin cifras (pendiente de definir) |

**Modo de la rebaja** (`owners.avaluo_rebate_mode`, parametrizable por propietario): hoy `precio_fijo` (decisión **provisoria, a validar con el contador**): el total al huésped no cambia; la rebaja solo reduce la base del IVA.

**Fórmula** (`vat_extract`):
- Rebaja `R` = `round(avalúo × tasa / 365 × noches)`; tasa = la de la propiedad o la del owner (0,11 por defecto). `R = 0` si no hay avalúo o el owner no aplica rebaja.
- `neto = min(T, round((T + 0,19 × R) / 1,19))` · `IVA = T − neto`. Así **neto + IVA = T siempre** (también con $40.000, que no tiene neto entero exacto) y el IVA nunca es negativo. Verificado en 20 totales × 2 rebajas.

### Ejemplo numérico para el contador

Iquique, 3 noches de lunes a miércoles para 2 personas, avalúo **ilustrativo** de $60.000.000 (no es el avalúo real):

| Concepto | Valor |
|---|---|
| Total al huésped (`T`) | 3 × $40.000 + aseo $6.000 = **$126.000** |
| Rebaja de base `R` | 60.000.000 × 0,11 / 365 × 3 = **$54.247** |
| Neto con rebaja | round((126.000 + 0,19 × 54.247) / 1,19) = **$114.544** |
| IVA con rebaja | 126.000 − 114.544 = **$11.456** |
| Sin rebaja (referencia) | neto $105.882 · IVA $20.118 |

Comprobación: base imponible = neto − R = 60.297; 19 % = 11.456 ✔. **Preguntas para el contador:** ¿se mantiene el precio publicado (la SpA paga menos IVA) o se traspasa la rebaja al huésped? ¿La rebaja se calcula por reserva o por período? ¿Qué régimen aplica a Santiago (`vat_applies` y `management_model`)?

## Interfaz

- Tarjetas: "desde **$40.000** / noche" o "Consultar precio".
- Ficha: detalle por tipo de noche ("2 noches × $40.000", "1 noche de fin de semana × $45.000", "3 noches de temporada Verano × $55.000"), aseo, huéspedes adicionales, **Total** y "Sin cargos por servicio de plataforma". Al recotizar conserva el bloque anterior ("Actualizando precio…"): sin parpadeo.
- Barra: "Total $X · N noches".
- WhatsApp: "… Total cotizado: $X."
- Formato: `formatCLP` (`src/lib/money.ts`), miles con punto, sin decimales.
- Datos de ejemplo: `src/lib/fixtures/pricing.ts` replica las reglas **solo para ver la interfaz en desarrollo**; no existe en producción y la verdad es SQL.
