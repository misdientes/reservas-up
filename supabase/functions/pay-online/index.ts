// Edge Function pay-online (pública): pagar en línea desde /reserva/:code.
//   POST { public_code }   (el código secreto de 128 bits del enlace)
// Cubre el SALDO de una reserva confirmada y el reintento de un hold por
// pasarela vigente (un pago rechazado no libera las fechas: decisión 10b).
// El monto lo decide la base (create_gateway_payment): un cobro pendiente a
// la vez (vence a los 30 min) y máximo 5 intentos por hora por reserva.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { startGatewayCharge } from '../_shared/payments/charge.ts'
import { corsHeaders, json } from '../_shared/http.ts'

const STATUS: Record<string, number> = {
  not_found: 404,
  nothing_to_pay: 409,
  payment_in_progress: 409,
  too_many_attempts: 429,
  method_not_allowed: 503,
  gateway_not_configured: 503,
  payments_unavailable: 503,
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ ok: false }, 405, cors)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const siteUrl = Deno.env.get('SITE_URL')
  if (!supabaseUrl || !siteUrl) return json({ ok: false, reason: 'payments_unavailable' }, 503, cors)

  const body = (await req.json().catch(() => ({}))) as { public_code?: unknown }
  const publicCode = typeof body.public_code === 'string' ? body.public_code : ''
  if (!/^[0-9a-f]{32}$/.test(publicCode)) return json({ ok: false, reason: 'not_found' }, 404, cors)

  const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: reservation } = await db.from('reservations').select('id').eq('public_code', publicCode).maybeSingle()
  if (!reservation) return json({ ok: false, reason: 'not_found' }, 404, cors)

  const charge = await startGatewayCharge(
    db,
    reservation.id as string,
    { SUPABASE_URL: supabaseUrl, SITE_URL: siteUrl, MOCK_WEBHOOK_SECRET: Deno.env.get('MOCK_WEBHOOK_SECRET'), PAYMENT_WEBHOOK_BASE_URL: Deno.env.get('PAYMENT_WEBHOOK_BASE_URL') },
    (name) => Deno.env.get(name),
  )
  if (!charge.ok) return json({ ok: false, reason: charge.reason }, STATUS[charge.reason] ?? 500, cors)
  return json({ ok: true, payment_url: charge.paymentUrl, amount_clp: charge.amountClp }, 200, cors)
})
