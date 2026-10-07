# Pruebas de base de datos

Corren contra la base remota (no requieren Docker) y **no dejan datos**: cada archivo trabaja dentro de una transacción que termina en `ROLLBACK`.

```
npx supabase db query --linked -f supabase/tests/anti_double_booking.sql
```

El resultado es una fila por caso con `esperado`, `obtenido` y `OK`/`FALLA`. Todas deben dar `OK`.

| Archivo | Qué prueba |
|---|---|
| `anti_double_booking.sql` | Reglas anti-doble-reserva (CLAUDE.md §4): solapamientos entre reservas, holds, bloqueos manuales e iCal; liberación de holds vencidos con margen para pagos en curso; protocolo de conflicto. |

Toda sesión que toque reservas, calendario o pagos debe volver a correrlas y agregar casos nuevos (CLAUDE.md §4.7).
