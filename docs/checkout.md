# Checkout y hold (Sesiones 9 y 10a)

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

## Pagos manuales y parciales (Sesión 10a)

Medios de esta etapa: **transferencia bancaria** y **link de pago TUU** que René envía a mano por WhatsApp. La pasarela automática llega en la Sesión 10b. No hay POS, efectivo ni cobro al llegar: todo se paga antes.

### Reglas (decisiones de René)

| Regla | Valor por defecto | Dónde se configura |
|---|---|---|
| Abono mínimo | `max(30 % del total, primera noche)`, redondeado al peso. Con `deposit_min_nights = N`, las N primeras noches | `deposit_percent`, `deposit_min_nights` |
| Plazo para pagar (transferencia o link) | 12 h, nunca después de la llegada; si no llega, las fechas se liberan solas | `manual_payment_window_hours` |
| Saldo | pagado 48 h antes de la llegada (hora de check-in de la propiedad, en Chile) | `balance_due_hours_before_checkin` |
| 100 % obligatorio | si `ahora + plazo ≥ vencimiento del saldo`: nadie reserva con abono si el saldo vencería durante el plazo de pago | (derivado) |
| Medios permitidos | `bank_transfer`, `payment_link` (la pasarela se habilita en S10b) | `allowed_payment_methods` |
| Cancelación | 100 % de lo pagado hasta 5 días antes; después, sin reembolso (los reembolsos se ejecutan en S15) | `cancellation_free_days`, `cancellation_refund_percent` |

- **Todo es configurable por propiedad.** Las columnas en `properties` valen `null` = se usa el valor global de `app_settings`.
- La única fuente es `payment_policy(property_id)`; el cálculo lo hace `payment_plan_core`.
- El público recibe el plan ya calculado con `quote_payment_plan`: total, abono, saldo, vencimiento, medios y cancelación, sin impuestos.

### Estados

**Esperando pago** = reserva `hold` con `payment_mode = 'manual'` y vencimiento de 12 h.
- La definición **única** de noche ocupada (`active_occupancies` / `occupied_ranges`), el job `release_expired_holds` (cada minuto) y la restricción de exclusión la cubren **sin cambios**: no existe una segunda definición.
- `occupancy_consistency.sql` lo verifica con un hold manual vigente y otro vencido.

**Estado de pago derivado** (`reservation_payment_state`):

| Estado | Cuándo |
|---|---|
| `esperando_pago` | hold manual vigente |
| `vencida` | hold vencido (el job lo libera en ≤ 1 min) |
| `abonada` | confirmada con saldo pendiente |
| `saldo_vencido` | confirmada, saldo pendiente y pasó `balance_due_at`. **No se cancela sola**: queda visible para el admin (los avisos por email llegan en S11) |
| `pagada` | `amount_paid = total` |
| `reembolso_pendiente` | `needs_refund` (por ejemplo, un pago tardío sin fechas libres) |

**Montos y acceso:**
- `reservations.amount_paid` es lo recibido; `balance_due = total − amount_paid` es una columna generada.
- `access_released` solo vale con la reserva confirmada y pagada completa. La cerradura y los emails se conectan en S11.

### Flujo

1. **Checkout:** el huésped elige el medio (transferencia o link) y el monto (abono o total; si se exige el 100 %, solo total). El botón dice "Reservar y ver datos de pago".
2. **`create-booking`:** `payment_method` + `payment_plan` → `create_booking_hold`.
   - Rechaza con `booking_disabled` si `booking_mode ≠ 'online'`. Es un candado en la base: en producción nadie puede bloquear fechas llamando directo a la función.
   - Otros rechazos: `method_not_allowed`, `full_payment_required`, `payment_account_missing` (transferencia sin cuenta de cobro).
   - Con un medio manual no hay cobro en un proveedor: responde `{ok, public_code}` y el sitio va a `/reserva/:code`.
3. **`/reserva/:code`** (enlace secreto de 128 bits):
   - Muestra el monto a pagar, el plazo y el **código corto** (`UP-XXXXX`) para el comentario de la transferencia.
   - Muestra los **datos bancarios** de la cuenta congelada en la reserva, solo mientras hay un monto pendiente por transferencia.
   - Tiene un botón de WhatsApp prellenado: "Hola, envío el comprobante de la reserva UP-XXXXX por $X" (o "quiero el link de pago…", o "quiero pagar el saldo…").
   - Se actualiza cada minuto mientras espera.
4. **René ve el dinero en su banco** → `/admin` → "Registrar pago recibido" (`register_manual_payment`).
5. **Primer pago ≥ abono** → `confirmada`. El trigger de la Sesión 9b congela el desglose tributario **una vez**, sobre `total_clp`; el pago del saldo no lo recongela.
6. **Saldo registrado** → `pagada`, `access_released = true`.

### Códigos de la reserva

- **Código corto** `UP-XXXXX` (`reservations.code`, generado por `new_reservation_code()`):
  - sin caracteres ambiguos (0/O, 1/I/L);
  - es el que se escribe en el comentario de la transferencia, en WhatsApp y en el panel;
  - **no** permite consultar el estado.
- **Código secreto** (`public_code`, 32 hex): solo va en el enlace `/reserva/:code`. Nunca aparece en textos para copiar al banco.

### Registro de pagos (`register_manual_payment`, solo admin)

> **Confirma solo cuando veas el dinero en tu banco, nunca por una foto del comprobante.**

**Validaciones:**
- Medio: transferencia o link. Monto mayor que 0.
- **N.º de operación (o id del link) obligatorio.**
- **Idempotente:** el mismo n.º de operación en la misma reserva y por el mismo monto responde `already_registered`, sin duplicar. En otra reserva o por otro monto, `duplicate_reference`.
- Monto mayor al saldo pendiente: `amount_exceeds_balance`.
- Primer pago menor al abono: `below_deposit`, **no se registra** (decisión de René). Coordina con el huésped y registra cuando complete el abono.

**Pago que llega después del vencimiento:** usa la misma lógica que el pago tardío de la pasarela (`try_reoccupy`, compartida con `confirm_payment`).
- Fechas libres → `late_confirmed`.
- Fechas tomadas → el pago queda registrado + `needs_refund` + incidente `late_approval_unavailable`.

**Registro:** cada pago guarda medio, tipo (`deposit` / `balance` / `full`), referencia, `received_at`, `registered_by`, nota y la cuenta de cobro congelada.

### Liberar fechas a mano (`release_manual_hold`, solo admin)

- Botón "Liberar fechas" en `/admin`, con confirmación y motivo opcional.
- Solo para un hold manual **sin pagos registrados**.
- Queda `cancelada` con motivo `liberado_admin`, `cancelled_by`, `cancelled_at` y `cancellation_note`.
- Si después llega el dinero, se trata como pago tardío.

### Si un huésped transfiere de más

El sistema no acepta montos mayores al saldo (`amount_exceeds_balance`). Procedimiento:
1. Registra **solo el saldo pendiente**, con el n.º de operación de la transferencia.
2. En la **nota**, anota el excedente: "Transfirió $X; excedente $Y a devolver".
3. Devuelve el excedente desde tu banco. El registro de reembolsos llega en la Sesión 15; mientras tanto, la nota es la constancia.

Si transfiere de más **en el primer pago** (por ejemplo, $50.000 cuando el total es $40.000), registra el total y anota el excedente igual.

### Cuentas de cobro (`payment_accounts`)

**Columnas:**
- Titular (`owner_id`; puede ser UP cobrando por cuenta de un tercero), `label`, proveedor.
- Datos de transferencia: banco, tipo y número de cuenta, titular, RUT y email.
- `gateway_secret_name`: solo el **nombre** del secreto de Supabase para la pasarela (S10b), nunca la clave.

**Relaciones:** la propiedad apunta a su cuenta (`properties.payment_account_id`), y la reserva y cada pago congelan la suya.

**Permisos:** RLS y lectura solo para el admin. El huésped ve los datos de su cuenta únicamente dentro de `public_booking_status`, con el enlace secreto. No hay vistas públicas con datos bancarios (hay una prueba de ello).

**Carga de datos reales:**
- René completa `privado/datos-pago.md` (ignorado por git).
- Claude genera `privado/payment-accounts.sql` y lo ejecuta con autorización, verificando con un conteo.
- Los datos bancarios nunca van al repositorio ni al chat.

### Panel `/admin`

**Acceso:**
- Enlace mágico de Supabase Auth (`signInWithOtp`, `shouldCreateUser: false`). El registro público sigue cerrado.
- Solo entra un usuario con rol `admin` activo en `app_users`; cada función vuelve a exigir `is_admin()`.

**Contenido:** reservas esperando pago (con vencimiento y abono mínimo), saldos pendientes y vencidos, y reembolsos pendientes (`admin_payment_queue`).

**Configuración de Auth en producción (una vez, René):** Supabase → Authentication → URL Configuration → Redirect URLs → agregar `https://reservas-up.pages.dev/admin`. En local está en `supabase/config.toml` y los correos llegan a Mailpit (http://127.0.0.1:54324).

**S11:** configurar Resend como SMTP de Supabase Auth, porque el correo por defecto tiene un límite bajo por hora.

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
