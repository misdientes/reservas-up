# Checkout y hold (Sesión 9)

Reserva directa con pago inmediato. El servidor decide el precio, la disponibilidad y la confirmación. El navegador solo muestra información y envía los datos del huésped.

## Interruptor `booking_mode` (`app_settings`, público)

| Valor | Ficha | `/reservar/:slug` |
|---|---|---|
| `whatsapp` (producción hoy) | Barra "Consultar por WhatsApp" | Muestra "Por ahora las reservas se coordinan por WhatsApp" |
| `online` | Barra "Reservar" → checkout | Formulario y pago |

Cualquier valor distinto de `online` se trata como `whatsapp` (es el modo seguro).

### Cómo activar el modo `online` (cuando exista un proveedor real, Sesión 10)

1. Widget de Turnstile creado (ver "Pausa B" en `ESTADO-PROYECTO.md`):
   - la clave pública va en `VITE_TURNSTILE_SITE_KEY` (Cloudflare Pages);
   - la secreta va en `TURNSTILE_SECRET_KEY` (secrets de Supabase).
2. Secrets de Supabase: `IP_HASH_SECRET`, `SITE_URL=https://reservas-up.pages.dev`, `ALLOWED_ORIGINS=https://reservas-up.pages.dev`, `PAYMENT_PROVIDER=<flow|mercadopago|tuu>` y las claves del proveedor.
3. `app_settings.booking_mode = 'online'` desde el panel (Sesión 12) o con SQL verificado con un conteo.

Si falta cualquiera de los secretos, `create-booking` responde `503 payments_unavailable` y no crea nada.

## Política de cancelación (`app_settings`, públicas)

- `cancellation_free_days` (5) y `cancellation_refund_percent` (100): reembolso hasta N días antes de la llegada, hasta las 23:59 de Chile del día límite.
- El checkout muestra la fecha concreta: "Cancelación gratuita hasta el domingo 22 de noviembre." Si ya pasó el día límite, muestra "Esta reserva no es reembolsable."
- La reserva congela su política en `reservations.cancellation_policy` (días, porcentaje y fecha límite) junto con la versión del documento aceptado.
- Lógica en `src/lib/cancellation.ts`, con pruebas.

## Flujo

```
Ficha (Reservar) ─► /reservar/:slug?llegada&salida&huespedes
   resumen (quote_stay) + datos mínimos + factura opcional + aceptación + Turnstile
   "Ir a pagar $X" ─► Edge Function create-booking
        a) Turnstile                     → 403 turnstile_failed
        b) validación (booking-input.ts) → 422 invalid + errores por campo
        c) syncProperty (iCal a demanda; regla 3)
        d) create_booking_hold (una transacción):
             sync_stale (último éxito > 15 min) · hold_limit (2 por email y 2 por IP)
             motivo de pricing_core · price_changed (total distinto al mostrado)
             huésped por email normalizado · reserva 'hold' (20 min)
             la restricción de exclusión decide → unavailable
        e) assert_hold_chargeable: choque abierto tipo 'hold' → conflict_hold (no cobra)
        f) PaymentProvider.createCharge + attach_payment (pago 'pendiente')
        g) 200 { payment_url, public_code }
   ─► pasarela del proveedor ─► webhook payment-webhook/<proveedor>
        verifyWebhook (firma) ─► confirm_payment (idempotente)
   ─► /reserva/:public_code   (consulta cada 3 s hasta ~2 min)
```

**La reserva se confirma solo por el webhook verificado**, nunca por la redirección del navegador.

### `confirm_payment` (resultados)

| Caso | Resultado |
|---|---|
| Aprobado, hold vigente y monto = total | `confirmed`: la reserva pasa a `confirmada` sin liberar las fechas |
| Aviso repetido | `already_processed` (sin efectos) |
| Aprobado tarde (hold ya liberado) y fechas libres | `late_confirmed` (se recotiza excluyendo la propia reserva) |
| Aprobado tarde y fechas tomadas | `needs_refund` + incidente (el reembolso es de la Sesión 15) |
| Monto distinto | `amount_mismatch`: no confirma + incidente |
| Rechazado o abandonado | `released`: hold cancelado, fechas libres |
| Otro pago aprobado para la misma reserva | `duplicate_payment` + incidente |

Los incidentes quedan en `payment_incidents` (solo los ve el admin).

### Precio cambiado

El navegador envía `expected_total_clp` **solo para comparar**. Si difiere del total de `pricing_core`, el servidor responde `409 price_changed` con el total nuevo, sin crear el hold. El checkout muestra "El precio se actualizó: $X", refresca el resumen y pide confirmar de nuevo.

### Huéspedes recurrentes

`guests` se identifica por `email_normalized` (`lower(trim(email))`, único). El mismo email crea un solo huésped y nunca se sobrescriben su nombre ni su teléfono. Cada reserva guarda su copia del contacto (`contact_name`, `contact_email`, `contact_phone` y `contact_country`), y la comunicación de esa reserva usa esa copia.

### Estado público `/reserva/:code`

`public_booking_status(public_code)`, con un código de 128 bits. Devuelve `procesando`, `confirmada`, `no_completada` o `en_revision`, además de la propiedad, las fechas, las noches, los huéspedes y el total. **Sin email ni teléfono.**

## Datos personales (Ley 21.719)

- **Se piden:** nombre, email, teléfono/WhatsApp y país. La factura (RUT validado con dígito verificador, razón social, giro y dirección) es opcional.
- **No se piden** documentos de identidad.
- **Consentimiento:** se guardan los ids de las versiones de Términos, Privacidad y Cancelación aceptadas y `consent_at`.
- **IP:** solo se guarda un HMAC (`client_ip_hash`), para el límite de holds. Nunca la IP.

## Pagos desacoplados

- `supabase/functions/_shared/payments/provider.ts` define la interfaz `PaymentProvider` (`createCharge`, `verifyWebhook` y `refund`).
- `getProvider()` elige el proveedor según `PAYMENT_PROVIDER`.
- Los adaptadores reales llegan en la Sesión 10.

### Proveedor simulado (`mock`): imposible en producción

1. **Edge Function:** `getProvider` lo rechaza si `SUPABASE_URL` no es local (127.0.0.1, localhost, kong, host.docker.internal).
2. **Base de datos:** el trigger `payments_guard_mock` rechaza un pago `mock` salvo que `app_settings.environment = 'local'`. Esa clave solo la crea `supabase/seed.sql`, y `db push` no ejecuta el seed.
3. **Frontend:** la página `/pasarela-prueba/:id` y sus textos solo entran al build `localdb`; se verifica con `grep` sobre `dist/`.
4. **La función `mock-gateway` no se despliega.**

## Entorno local (Docker)

```
npx supabase start                         # base + API local (http://127.0.0.1:54321)
npx supabase db reset                      # SOLO local: migraciones + seed de ejemplo
npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
npm run dev:localdb                        # sitio en http://localhost:5174 (.env.localdb)
npm run test:checkout                      # integración HTTP (20 casos, limpia lo que crea)
```

- `.env.localdb` y `supabase/functions/.env` están fuera de git. Contienen las claves de demostración locales de Supabase, las claves de prueba oficiales de Turnstile y `PAYMENT_PROVIDER=mock`.
- El seed local publica 3 propiedades de ejemplo, activa `booking_mode = 'online'` y desprograma `ical-import`.
- Las pruebas SQL con varias sentencias se corren en local con psql dentro del contenedor:
  `docker exec -i supabase_db_reservas-up psql -X -q -t -A -F '|' -U postgres -d postgres < supabase/tests/checkout.sql`

## Pruebas

| Prueba | Cubre |
|---|---|
| `supabase/tests/checkout.sql` (43 casos; local y producción) | Flujo feliz; webhook ×3; rechazo; aprobación tardía (libre y tomada); monto alterado; choque `hold`; sync > 15 min; límite de holds por email e IP; total del servidor; `price_changed`; huésped recurrente; mock rechazado fuera de local; permisos |
| `scripts/test-checkout.mjs` (20 casos; solo local) | Concurrencia real (2 solicitudes simultáneas → 1 hold); flujo HTTP con la pasarela; webhook repetido; montos inyectados ignorados; Turnstile; validación |
| `npm test` | RUT, validación de la solicitud, guardia del mock, firma HMAC, fecha límite de cancelación y sus textos, formato de los documentos legales |
