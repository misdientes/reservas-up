// Edge Function mock-gateway: la "pasarela de prueba" (SOLO LOCAL; no se
// despliega). La página /pasarela-prueba/:id llama aquí con la acción del
// usuario y esta función envía al webhook un aviso FIRMADO, igual que lo
// haría un proveedor real. Fuera de la base local responde 404.
//   POST { payment_id, action: 'approve' | 'reject' | 'abandon', amount_override? }

import { createClient } from 'npm:@supabase/supabase-js@2'
import { isLocalSupabase } from '../_shared/payments/provider.ts'
import { hmacHex, MOCK_SIGNATURE_HEADER } from '../_shared/payments/mock.ts'
import { corsHeaders, json } from '../_shared/http.ts'

const STATUS = { approve: 'approved', reject: 'rejected', abandon: 'abandoned' } as const

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secret = Deno.env.get('MOCK_WEBHOOK_SECRET')
  if (!isLocalSupabase(supabaseUrl) || !secret || req.method !== 'POST') return json({ ok: false }, 404, cors)

  const body = (await req.json().catch(() => ({}))) as { payment_id?: string; action?: keyof typeof STATUS; amount_override?: number }
  // Desde la 10b la referencia (24 hex) la crea create_gateway_payment.
  if (!/^[0-9a-f]{24}$/.test(body.payment_id ?? '') || !body.action || !(body.action in STATUS)) return json({ ok: false }, 400, cors)

  const db = createClient(supabaseUrl!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: payment } = await db
    .from('payments')
    .select('amount_clp, reservations(public_code)')
    .eq('provider', 'mock')
    .eq('provider_payment_id', body.payment_id)
    .maybeSingle()
  if (!payment) return json({ ok: false, reason: 'unknown_payment' }, 404, cors)

  // Aviso firmado al webhook, como un proveedor real. amount_override solo
  // existe para probar el caso "monto alterado".
  const event = JSON.stringify({
    provider_payment_id: body.payment_id,
    status: STATUS[body.action],
    amount_clp: typeof body.amount_override === 'number' ? body.amount_override : payment.amount_clp,
  })
  const response = await fetch(`${supabaseUrl!.replace(/\/$/, '')}/functions/v1/payment-webhook/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [MOCK_SIGNATURE_HEADER]: await hmacHex(secret, event) },
    body: event,
  })
  const result = await response.json().catch(() => ({}))
  const reservation = payment.reservations as { public_code?: string } | null
  return json({ ok: response.ok, outcome: (result as { outcome?: string }).outcome, public_code: reservation?.public_code }, 200, cors)
})
