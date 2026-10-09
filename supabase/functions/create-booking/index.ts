// Edge Function create-booking: crea una reserva directa con hold y
// devuelve la URL de pago. El servidor decide todo; el navegador nunca
// envía un monto a cobrar (expected_total_clp solo se compara).
// Orden obligatorio (docs/checkout.md):
//  a) Turnstile  b) validación + límite de holds  c) revalidar iCal
//  d) precio de pricing_core  e) hold  f) sin choque tipo 'hold'
//  g) cobro en el proveedor + pago pendiente  h) URL de pago
// Pagos manuales (Sesión 10a: transferencia o link enviado por WhatsApp):
// no hay cobro en un proveedor; el hold dura 12 h y el huésped ve las
// instrucciones en /reserva/:code. Los registra el admin al ver el dinero.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { validateBookingRequest } from '../_shared/booking-input.ts'
import { verifyTurnstile } from '../_shared/turnstile.ts'
import { syncProperty } from '../_shared/ical-sync.ts'
import { startGatewayCharge } from '../_shared/payments/charge.ts'
import { hmacHex } from '../_shared/payments/mock.ts'
import { clientIp, corsHeaders, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405, cors)

  const env = {
    PAYMENT_PROVIDER: Deno.env.get('PAYMENT_PROVIDER'),
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SITE_URL: Deno.env.get('SITE_URL'),
    MOCK_WEBHOOK_SECRET: Deno.env.get('MOCK_WEBHOOK_SECRET'),
  }
  // Configuración mínima: sin Turnstile no se aceptan reservas. El modo
  // (booking_mode = 'online') lo exige además create_booking_hold.
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
  const ipSecret = Deno.env.get('IP_HASH_SECRET')
  if (!turnstileSecret || !ipSecret || !env.SITE_URL) {
    return json({ ok: false, reason: 'payments_unavailable' }, 503, cors)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reason: 'invalid' }, 400, cors)
  }

  // a) Turnstile (antes que cualquier otra cosa costosa).
  const ip = clientIp(req)
  const token = (body as { turnstile_token?: unknown })?.turnstile_token
  if (!(await verifyTurnstile(typeof token === 'string' ? token : '', turnstileSecret, ip))) {
    return json({ ok: false, reason: 'turnstile_failed' }, 403, cors)
  }

  // b) Validación (el límite de holds se aplica en create_booking_hold).
  const validation = validateBookingRequest(body)
  if (!validation.ok) return json({ ok: false, reason: 'invalid', errors: validation.errors }, 422, cors)
  const input = validation.value
  // La pasarela (si el huésped la eligió) sale de la cuenta de cobro de la
  // propiedad: create_booking_hold exige que esté configurada.
  const gateway = input.payment_method === 'gateway'
  const ipHash = ip ? await hmacHex(ipSecret, ip) : null

  const db = createClient(env.SUPABASE_URL!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // c) Revalidar con Airbnb/Booking (CLAUDE.md §4 regla 3). Si falla, la
  //    frescura (≤ 15 min del último éxito) la exige create_booking_hold.
  const { data: propertyId } = await db.rpc('published_property_id', { p_slug: input.slug })
  if (!propertyId) return json({ ok: false, reason: 'not_found' }, 404, cors)
  try {
    await syncProperty(db, propertyId as string)
  } catch {
    // Se evalúa abajo con property_sync_fresh.
  }

  // d) + e) Precio del motor y hold (todo en una transacción en la base).
  const { data: hold, error: holdError } = await db.rpc('create_booking_hold', {
    p_slug: input.slug,
    p_check_in: input.check_in,
    p_check_out: input.check_out,
    p_guests: input.guests,
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone,
    p_country: input.country,
    p_invoice: input.invoice,
    p_client_ip_hash: ipHash,
    p_expected_total_clp: input.expected_total_clp,
    p_payment_method: input.payment_method,
    p_payment_plan: input.payment_plan,
  })
  if (holdError || !hold) {
    console.error(JSON.stringify({ evento: 'create-booking-hold-error', codigo: holdError?.code }))
    return json({ ok: false, reason: 'error' }, 500, cors)
  }
  const result = hold as { ok: boolean; reason?: string; total_clp?: number; reservation_id?: string; public_code?: string }
  if (!result.ok) {
    const status =
      result.reason === 'hold_limit' ? 429
      : result.reason === 'not_found' ? 404
      : ['booking_disabled', 'payment_account_missing', 'gateway_not_configured'].includes(result.reason ?? '') ? 503
      : 409
    return json({ ok: false, reason: result.reason, total_clp: result.total_clp }, status, cors)
  }

  const reservationId = result.reservation_id!
  const publicCode = result.public_code!

  // f) Un canal externo pudo vender esas noches mientras tanto: no se cobra.
  const { data: chargeable } = await db.rpc('assert_hold_chargeable', { p_reservation_id: reservationId })
  if (!(chargeable as { ok?: boolean })?.ok) {
    return json({ ok: false, reason: (chargeable as { reason?: string })?.reason ?? 'unavailable' }, 409, cors)
  }

  // Pago manual: sin cobro en un proveedor. El huésped ve el monto, el plazo
  // y los datos de pago en /reserva/:code (enlace secreto).
  if (!gateway) {
    return json({ ok: true, public_code: publicCode, total_clp: result.total_clp, payment_mode: 'manual' }, 200, cors)
  }

  // g) + h) Cobro en la pasarela de la cuenta por el monto DEL SERVIDOR
  //    (abono o total) y URL de pago. Si no se puede iniciar, se libera el hold.
  const charge = await startGatewayCharge(
    db,
    reservationId,
    { ...env, SUPABASE_URL: env.SUPABASE_URL!, SITE_URL: env.SITE_URL!, PAYMENT_WEBHOOK_BASE_URL: Deno.env.get('PAYMENT_WEBHOOK_BASE_URL') },
    (name) => Deno.env.get(name),
  )
  if (!charge.ok) {
    await db.rpc('cancel_booking_hold', { p_reservation_id: reservationId, p_reason: 'pago_no_iniciado' })
    console.error(JSON.stringify({ evento: 'create-booking-charge-error', motivo: charge.reason }))
    return json({ ok: false, reason: 'payments_unavailable' }, 503, cors)
  }
  return json({ ok: true, payment_url: charge.paymentUrl, public_code: publicCode, total_clp: result.total_clp }, 200, cors)
})
