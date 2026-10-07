# Datos reales

Cargados en la Sesión 4 (2026-10-07). **Los valores sensibles no están en este repositorio**: viven en la base y en la carpeta local `privado/` (ignorada por git).

## Dónde están los datos

| Archivo (solo en el equipo de René) | Qué es |
|---|---|
| `privado/datos-reales.md` | Plantilla que René llena en VS Code: propietarios, administrador, tarifas, temporadas, propiedades, calendarios. |
| `privado/seed-datos-reales.sql` | Carga inicial (un único bloque `DO`, todo o nada; se niega a correr si los datos ya están). |

`privado/` está en `.gitignore`. Antes de escribir ahí se verifica con `git check-ignore privado/<archivo>`.

## Qué se cargó

| Tabla | Filas | Notas |
|---|---|---|
| `owners` | 2 | UP SpA (empresa, afecta a IVA, con rebaja del avalúo) y René (persona natural, **IVA pendiente**: `vat_applies = null`). Razón social exacta de la SpA pendiente de confirmar. |
| `managers` | 1 | UP SpA, comisión 0% (configurable). Contacto en blanco. |
| `rate_groups` | 2 | Uno para Iquique (compartido por los 2 departamentos) y uno para Santiago. Precios **con IVA**; fin de semana = viernes y sábado; sin tarifa de fin de semana distinta (null = igual al base). |
| `rate_seasons` | 0 | Sin temporadas por ahora. |
| `properties` | 3 | Todas en **borrador**, tipo departamento, llegada autónoma. |
| `external_calendars` | 0 | Sin URLs de iCal por ahora. |

### Propiedades (nombres y slugs PROVISIONALES)

| id | slug | Ciudad | Dueño | Administrador | Modelo |
|---|---|---|---|---|---|
| `6329f9ea-9843-4e69-af0c-b78a3cefdcd4` | `iquique-1` | Iquique | UP SpA | — | directo |
| `2b4fb90c-3a49-4ebd-a787-b73e66e45ba3` | `iquique-2` | Iquique | UP SpA | — | directo |
| `78cde6bc-5f2b-4832-903a-6844874947ba` | `santiago-1` | Santiago | René | UP SpA (0%) | **pendiente del contador** |

El nombre y el slug se cambiarán cuando René entregue los definitivos. La ficha (descripción, capacidad, dormitorios, camas, baños, amenidades, reglas, horarios, comuna, dirección, avalúo) está **en blanco**: no se usan valores por defecto inventados.

## Precios: se guardan CON IVA

Decisión de la Sesión 4 (ver CLAUDE.md §3): un precio como $40.000 con IVA no tiene un neto entero exacto (33.613 → $39.999; 33.614 → $40.001). Por eso las tarifas se guardan tal como las paga el huésped, y en cada reserva el servidor calcula `neto = round(total / 1,19)` e `IVA = total − neto`, como en una boleta.

Conversión validada por René (con IVA → neto de referencia):

| Concepto | Con IVA (guardado) | Neto (referencia) | IVA |
|---|---|---|---|
| Iquique · noche | 40.000 | 33.613 | 6.387 |
| Iquique · aseo por estadía | 6.000 | 5.042 | 958 |
| Iquique · huésped extra por noche | 15.000 | 12.605 | 2.395 |
| Santiago · noche | 35.000 | 29.412 | 5.588 |
| Santiago · aseo por estadía | 6.000 | 5.042 | 958 |
| Santiago · huésped extra por noche | 10.000 | 8.403 | 1.597 |

En una reserva el neto se calcula sobre el **total**, no línea por línea. Ejemplo, 2 noches + aseo en Iquique: total $86.000 → neto $72.269, IVA $13.731.

### Cómo se extraen el neto y el IVA (nunca se suma IVA sobre un precio guardado)

Sea `T` el total de la reserva calculado con las tarifas guardadas (con IVA):

| Caso | Neto | IVA |
|---|---|---|
| Propietario afecto, sin rebaja | `round(T / 1,19)` | `T − neto` |
| Propietario afecto, con rebaja del avalúo `R` (base rebajada de la estadía) | `round((T + 0,19 × R) / 1,19)` | `T − neto` (= 19% de `neto − R`) |
| Propietario sin IVA (`vat_applies = false`) | `T` (el precio guardado es el total sin IVA) | 0 |
| IVA pendiente (`vat_applies = null`) | **se cotiza igual** (el precio guardado es el final); el desglose interno queda `pending`, sin cifras (Sesión 7) | — |

**Rebaja del avalúo fiscal:** la ley rebaja la **base del IVA** en el 11% anual del avalúo fiscal, proporcional a las noches: `R = avalúo × 0,11 / 365 × noches`. Depende del avalúo de cada departamento (los 2 de Iquique comparten tarifa pero pueden tener avalúos distintos) y de las noches de cada reserva, así que se calcula por reserva y no cambia las tarifas guardadas.

Ejemplo ilustrativo (avalúo de $60.000.000, 2 noches + aseo en Iquique, `T` = $86.000): `R` = 36.164 → neto $78.043, IVA $7.957 (sin rebaja serían neto $72.269 e IVA $13.731). Es decir, **manteniendo el precio publicado**, la rebaja reduce el IVA que paga la SpA. La alternativa (traspasar la rebaja al huésped bajando `T`) y el cálculo exacto se validan con el contador en la Sesión 7. En ningún caso el huésped paga más que el precio publicado.

**Santiago:** si el contador define que no está afecto a IVA (`vat_applies = false`), el precio de $35.000 no cambia; solo cambia el desglose (neto = total, IVA = 0).

## Reglas para el motor de precios (implementadas en la Sesión 7: ver [docs/precios.md](precios.md))

- **Fin de semana:** una noche es de fin de semana si el día ISO de su fecha (1 = lunes … 7 = domingo) está en `rate_groups.weekend_nights` (por defecto `{5,6}` = viernes y sábado). Si `weekend_nightly_gross_clp` es null, se cobra la tarifa base.
- **Temporadas:** si la noche cae en una temporada del grupo, se usa su precio (y su precio de fin de semana, o el de la temporada si es null). Las temporadas de un grupo no pueden solaparse (restricción de exclusión).
- **Mínimo de noches:** se aplica el **mayor** entre `properties.min_nights` y el `min_nights` de la temporada (si lo tiene).
- **Pendientes tributarios:** ~~no se cotiza~~ — **corregido en la Sesión 7 (decisión de René):** un IVA o modelo tributario pendiente NO bloquea la cotización pública (Santiago se cotiza igual que Iquique); solo el desglose interno (`internal_tax_breakdown`) devuelve `tax_status = pending`.

## Cómo completar los datos después

1. René abre `privado/datos-reales.md`, completa lo que tenga (lo vacío sigue en blanco) y avisa.
2. Claude genera `privado/actualizar-datos-<fecha>.sql` con `UPDATE` por `slug`/`id` en un único bloque `DO` y lo ejecuta con `npx supabase db query --linked -f …`.
3. **Verificación con lectura posterior** (CLAUDE.md §3): consultar los campos actualizados; un comando sin error no garantiza el guardado.
4. Volver a correr las pruebas (`supabase/tests`): usan sus propios datos y no tocan los reales.

Las fotos siguen [docs/fotos.md](fotos.md).
