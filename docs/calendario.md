# Calendario de disponibilidad (ficha de propiedad)

Sesión 6. Lógica en `src/lib/dates/day.ts` y `src/lib/calendar/availability.ts` (pura, probada con `npm test`); interfaz en `src/components/property/StayCalendar.tsx`. El servidor vuelve a validar todo al crear la reserva (Sesión 9): el calendario solo evita ofrecer fechas imposibles.

## Reglas

| Regla | Cómo se aplica |
|---|---|
| Fechas | Cadenas `YYYY-MM-DD` en el calendario de Chile. Nunca se convierte una fecha de estadía a `Date` con hora; el "ahora" se traduce a Chile con `Intl` (`America/Santiago`). |
| Estadía | `[llegada, salida)`: un día ocupado no sirve como llegada, pero sí como salida si es el primer día de una ocupación. |
| Pasado y anticipación | Llegada más temprana = `ahora + min_advance_hours` (instante real) llevado a fecha y hora de Chile; si esa hora es posterior al check-in de ese día, pasa al día siguiente. Sin hora de check-in se asume 00:00 (lo más conservador). |
| Ventana | **548 días** desde hoy, igual que `get_property_availability` (`daterange(p_from, p_from + 548, '[)')`). Constante única: `AVAILABILITY_WINDOW_DAYS`. Los días fuera de lo consultado se muestran no disponibles. |
| Ocupaciones | La selección no puede cruzar una noche ocupada. |
| Mínimo de noches | El de la propiedad (las temporadas se suman en la Sesión 7: se aplica el mayor). |
| URL | `?llegada&salida&huespedes` se sincronizan al elegir; si el enlace trae fechas inválidas, ocupadas o huéspedes fuera de rango, se descartan con aviso y se limpia la URL. `destino` se conserva para "Volver". |
| Disponibilidad fresca | Se vuelve a consultar al volver a la pestaña (`visibilitychange`) y justo antes de abrir WhatsApp. Si las fechas elegidas se ocuparon: no se abre WhatsApp, se limpian y se avisa "Esas fechas acaban de ocuparse, elige otras". |

## Navegación con teclado

Patrón *grid* de WAI-ARIA con foco itinerante (una sola parada de tabulación):

1. **Tab** entra a la cuadrícula en el día activo (la llegada elegida o la primera fecha posible).
2. **← →** día anterior/siguiente · **↑ ↓** semana anterior/siguiente (cruza de mes y cambia el mes mostrado).
3. **Inicio / Fin** lunes / domingo de esa semana.
4. **Re Pág / Av Pág** mismo día del mes anterior/siguiente (**Mayús** = año). Si el día no existe (31 → 30), va al último del mes.
5. **Enter / Espacio** elige: primero la llegada, luego la salida. Un día no disponible no se elige y se explica por qué en un mensaje anunciado.
6. **Tab** sale de la cuadrícula (a la barra de reserva).

Cada día tiene `aria-label` con la fecha completa y su estado ("jueves 15 de octubre de 2026, llegada elegida", "…, no disponible", "…, disponible solo como salida"). Los días no disponibles se tachan además de usar el color `unavailable`. Celdas de 44px.

Verificado en la Sesión 6 con eventos de teclado reales (CDP `Input.dispatchKeyEvent`) sobre Edge.
