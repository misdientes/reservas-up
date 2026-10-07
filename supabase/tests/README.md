# Pruebas de base de datos

Corren contra la base remota (no requieren Docker) y **no dejan datos**: cada archivo trabaja dentro de una transacción que termina en `ROLLBACK`.

```
npx supabase db query --linked -f supabase/tests/anti_double_booking.sql
npx supabase db query --linked -f supabase/tests/role_permissions.sql
```

El resultado es una fila por caso con `esperado`, `obtenido` y `OK`/`FALLA`. Todas deben dar `OK`.

| Archivo | Qué prueba |
|---|---|
| `anti_double_booking.sql` | Reglas anti-doble-reserva (CLAUDE.md §4): solapamientos entre reservas, holds, bloqueos manuales e iCal; liberación de holds vencidos con margen para pagos en curso; protocolo de conflicto. |
| `role_permissions.sql` | Matriz de permisos por rol (Sesión 3): público, autenticado sin perfil, encargado, propietario y admin; vistas, funciones, Storage y protección del último admin. Simula cada rol con `set_config(role)` + `request.jwt.claims`. |

Toda sesión que toque reservas, calendario o pagos debe volver a correrlas y agregar casos nuevos (CLAUDE.md §4.7).
