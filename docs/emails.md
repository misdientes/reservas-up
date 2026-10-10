# Correos transaccionales (Sesión 11)

Correos al huésped y al admin. Se encolan en la base **en la misma transacción** que el cambio que los origina, y un worker los envía por Resend con reintentos.

## Garantías

- **Un evento, un correo:** `email_outbox.event_key` es único (por ejemplo `res:<id>:payment_received:<monto pagado>`). Un webhook repetido o un registro idempotente no duplican.
- **Nada se pierde si falla el envío:** el correo queda `pendiente` y se reintenta con backoff de 1, 2, 4, 8 y 16 minutos. Al 6.º intento queda `fallido`, con `last_error`.
- **Correos atascados:** si el worker se corta, los que quedaron `enviando` más de 10 minutos vuelven a `pendiente` sin sumar un intento. El `Idempotency-Key` de Resend (igual al `event_key`) evita un duplicado si el primer envío sí había salido.
- **Contenido al momento de enviar:** `email_context` lee el estado actual. Un correo que ya no corresponde se marca `omitido`, con su motivo.
- **Sin transporte, sin cola consumida:** sin `EMAIL_TRANSPORT`, `RESEND_API_KEY` o `SITE_URL`, el worker responde 503 **antes** de reclamar. Los correos quedan `pendiente`, sin gastar intentos.
- **Sin ráfaga de correos viejos al activar Resend:**

| Correo | Se omite si… |
|---|---|
| Cualquier alerta al admin | tiene más de 24 h (`alerta_antigua`) |
| Saldo vencido (admin) | el saldo ya se pagó |
| Reserva creada | la reserva ya no espera pago o el hold venció |
| Pago recibido | la reserva ya no está confirmada o quedó para reembolso |
| Recordatorio de saldo | el saldo se pagó o ya venció (el admin recibe "saldo vencido") |
| Fechas liberadas | la reserva se recuperó con un pago tardío |
| Llegada / código de acceso | la reserva no está confirmada |
| Cualquiera al huésped | la estadía ya terminó (`estadia_terminada`) |
| Código de acceso | el código fue reemplazado: solo sale el vigente |
- **Horas en Chile:** programaciones y textos usan `America/Santiago`. La llegada es la fecha de check-in más la hora de check-in de la propiedad.
- **Sin IVA:** solo precios finales. Hay una prueba en las plantillas, otra en los correos enviados y el `grep` de `dist/`.

## Eventos

| Evento | Destinatario | Plantilla | Cuándo |
|---|---|---|---|
| Hold manual creado | huésped | `guest_booking_created` | al instante (se omite si ya no espera pago) |
| Hold manual creado | admin | `admin_new_booking` | al instante |
| Pago registrado o aprobado (cada aumento de lo pagado) | huésped | `guest_payment_received` | al instante; abono con saldo y fecha, o pago completo |
| Confirmada con saldo | huésped | `guest_balance_reminder` | vencimiento del saldo − 24 h (se omite si ya pagó) |
| Pagada completa | huésped | `guest_arrival_info` | al instante; si se pagó con más de 7 días de anticipación, 3 días antes de la llegada (15:00 de Chile) |
| Código de acceso cargado o cambiado **después** de enviar la llegada | huésped | `guest_access_code` | al instante; uno por versión del código |
| Hold manual vencido o liberado por el admin | huésped | `guest_released` | al instante |
| Pago por pasarela aprobado | admin | `admin_gateway_payment` | al instante |
| Reserva que queda para reembolso | admin | `admin_refund_needed` | al instante |
| Saldo vencido | admin | `admin_balance_overdue` | job cada 15 min; una vez por reserva |
| Fuente iCal sin éxito hace más de 60 min | admin | `admin_sync_alert` | job cada 15 min; una vez por caída |

## Piezas

- **`email_outbox`:** estado `pendiente` / `enviando` / `enviado` / `fallido` / `omitido`, intentos, `last_error`, `send_after` e id del proveedor. RLS: solo el admin lee.
- **Triggers:** `reservations_enqueue_emails` y `payments_enqueue_emails`.
- **Job SQL `email-alerts`:** cada 15 min, llama a `enqueue_scheduled_alerts()`.
- **Edge Function `email-worker`:**
  - pg_cron (`email-worker`, cada minuto) la llama vía pg_net con `x-cron-secret`, el mismo secreto de `ical-import` (`ICAL_CRON_SECRET` + Vault `ical_cron_secret`);
  - ciclo: `claim_emails` → `email_context` → renderizado → transporte → `mark_email_result`.
- **Renderizado** (`supabase/functions/_shared/email/render.ts`):
  - plantillas con `{{variable}}`, `{{#v}}…{{/v}}` y `{{^v}}…{{/v}}`;
  - HTML simple con los colores de los tokens y versión de texto;
  - datos escapados.
- **Transporte desacoplado** (`_shared/email/transport.ts`): `resend` en producción; `mailpit` solo en la pila local (mismo candado que el pago simulado).

## Plantillas (`message_templates`)

- La migración carga una versión **global** (`property_id` nulo) de cada plantilla.
- Una propiedad puede tener su **propia** versión (misma `key`, con `property_id`), que gana sobre la global.
- Se editan con SQL hasta que exista el panel. Mantener el formato: párrafos separados por una línea en blanco, `- ` para listas, sin HTML.

## Datos privados de llegada

- **`property_arrival_info`** (solo admin): dirección exacta (si no, `properties.address`), cómo entrar, wifi, estacionamiento y notas. Nunca aparece en vistas públicas ni en `/reserva/:code`; solo en los correos de llegada.
- **Código de acceso por reserva:** tabla `access_codes`. Lo carga el admin en `/admin` → "Próximas llegadas" (`set_reservation_access_code`), mientras no haya cerradura integrada.

## Configuración

| Dónde | Clave | Valor |
|---|---|---|
| `app_settings` (privada) | `email_from_address` | remitente, por ejemplo `reservas@tu-dominio.cl` (dominio verificado en Resend) |
| `app_settings` (privada) | `email_from_name` | `Reservas UP` |
| `app_settings` (privada) | `admin_email` | correo donde llegan los avisos al admin |
| Secreto de Supabase | `EMAIL_TRANSPORT` | `resend` |
| Secreto de Supabase | `RESEND_API_KEY` | clave de Resend (René la crea con `--env-file` desde `privado/`) |
| Secreto de Supabase | `SITE_URL` | `https://reservas-up.pages.dev` (enlaces de los correos) |

**Sin transporte o sin `SITE_URL`**, el worker responde 503 y no toma nada: los correos esperan en `pendiente`.

**Sin `admin_email` o sin remitente**, ese correo se omite o falla con el motivo registrado.

## Pasos para René: dominio y Resend

1. **Dominio propio** (por ejemplo `reservasup.cl`), si aún no existe.
2. **Resend → Domains → Add domain:** copiar los registros DNS (SPF, DKIM y, opcional, DMARC) en el proveedor del dominio y esperar el estado "Verified". Sin dominio verificado, Resend solo entrega al correo de la propia cuenta.
3. **Resend → API Keys → Create** (permiso "Sending access"). Guardarla en `privado/resend.env` como `RESEND_API_KEY=…` y ejecutar `npx supabase secrets set --env-file privado/resend.env`. Nunca pegarla en el chat.
4. Definir `email_from_address` (del dominio verificado) y `admin_email` en `app_settings`.
5. **Supabase → Authentication → Emails → SMTP Settings:** usar Resend como SMTP (host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = la API key). Así los enlaces mágicos del panel no dependen del límite bajo del correo por defecto de Supabase.

## Local

- `npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt`. El `.env` local tiene `EMAIL_TRANSPORT=mailpit`, `MAILPIT_URL` e `ICAL_CRON_SECRET`.
- En local el job `email-worker` está desprogramado (apunta a producción): `node scripts/test-emails.mjs` llama al worker y revisa los correos en Mailpit (http://127.0.0.1:54324).
- Pruebas: `supabase/tests/email_outbox.sql` (50 casos), `scripts/test-emails.mjs` (19) y vitest (`_shared/email/email.test.ts`).
