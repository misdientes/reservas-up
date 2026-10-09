# Pruebas de base de datos

Corren contra la base remota (no requieren Docker) y **no dejan datos**: cada archivo trabaja dentro de una transacción que termina en `ROLLBACK`.

```
npx supabase db query --linked -f supabase/tests/anti_double_booking.sql
npx supabase db query --linked -f supabase/tests/role_permissions.sql
npx supabase db query --linked -f supabase/tests/pricing.sql
npx supabase db query --linked -f supabase/tests/ical_sync.sql
npx supabase db query --linked -f supabase/tests/occupancy_consistency.sql
npx supabase db query --linked -f supabase/tests/checkout.sql
npx supabase db query --linked -f supabase/tests/multi_owner.sql
npm test   # incluye el parser iCal (supabase/functions/_shared/ical.test.ts, fixtures en supabase/tests/fixtures/)
```

El resultado es una fila por caso con `esperado`, `obtenido` y `OK`/`FALLA`. Todas deben dar `OK`.

| Archivo | Qué prueba |
|---|---|
| `anti_double_booking.sql` | Reglas anti-doble-reserva (CLAUDE.md §4): solapamientos entre reservas, holds, bloqueos manuales e iCal; liberación de holds vencidos con margen para pagos en curso; protocolo de conflicto. |
| `role_permissions.sql` | Matriz de permisos por rol (Sesión 3): público, autenticado sin perfil, encargado, propietario y admin; vistas, funciones, Storage y protección del último admin. Simula cada rol con `set_config(role)` + `request.jwt.claims`. |
| `pricing.sql` | Motor de precios (Sesión 7): tarifas base, fin de semana y temporada; mínimo efectivo; huéspedes extra; anticipación (borde exacto); reserva propia excluida; disponibilidad; neto + IVA = total; desglose interno solo admin; "desde". |
| `ical_sync.sql` | Sincronización iCal (Sesión 8): importar, actualizar, fuente caída y archivo corrupto no liberan, confirmación doble antes de liberar, choques reserva / hold / cubierto, Airbnb + Booking, exportación sin bucles ni holds, `sync_health`, permisos. |
| `checkout.sql` | Checkout y pagos (Sesión 9): hold → pago → confirmada sin liberar; webhook repetido; rechazo; aprobación tardía (libre / tomada → `needs_refund`); monto alterado; choque `hold`; sync > 15 min; límite de holds; `price_changed`; huésped recurrente; pago `mock` imposible fuera de local; permisos. Detalle en `docs/checkout.md`. |
| `multi_owner.sql` | Varias propiedades y dueños (Sesión 9b): tarifa de otro dueño rechazada; `change_property_owner` solo admin, sin cambios parciales, con historial y conteo de reservas futuras del dueño anterior; desglose congelado al confirmar (con IVA y rebaja, exento, pendiente, pago tardío); segundo pago y cambios posteriores del dueño no lo alteran; nada tributario en el estado público. |
| `occupancy_consistency.sql` | Definición única de "noche ocupada": calendario público y motor de precios coinciden noche a noche con reservas, holds (vigente y vencido), bloqueos manual e iCal y canceladas. |

**Entorno local (Docker):** `db query --local` no acepta varias sentencias; se usa psql dentro del contenedor:
`docker exec -i supabase_db_reservas-up psql -X -q -t -A -F '|' -U postgres -d postgres < supabase/tests/<archivo>.sql`
La integración HTTP del checkout (concurrencia real con las Edge Functions) es solo local: `npm run test:checkout`.

Toda sesión que toque reservas, calendario o pagos debe volver a correrlas y agregar casos nuevos (CLAUDE.md §4.7).
