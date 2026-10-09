// Edge Function payment-webhook: recibe el aviso de pago del proveedor.
//   POST /functions/v1/payment-webhook/<proveedor>
// Es lo ÚNICO que confirma un pago (CLAUDE.md §5); las redirecciones del
// navegador nunca cambian estados. confirm_payment es idempotente: el mismo
// aviso N veces (TUU reintenta hasta 10) no duplica nada.
//
// TUU: NADA se escribe antes de autenticar. 1) la cuenta se identifica por
// x_account_id (solo lectura); 2) se verifica x_signature con la clave de
// ESA cuenta (tiempo constante); 3) recién entonces se busca el pago o se
// registra un incidente. Cuenta desconocida o firma inválida → 401.
// Responde 200 solo si procesó (incluso un pago rechazado); un error de la
// base → 500 para que TUU reintente.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getProvider, isGatewaySecretName } from '../_shared/payments/provider.ts'
import { parseTuuCallback, tuuAmount, tuuResult, verifyTuuSignature } from '../_shared/payments/tuu.ts'
import { json } from '../_shared/http.ts'

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function handleTuu(req: Request): Promise<Response> {
  const fields = parseTuuCallback(await req.text())
  const accountId = fields.x_account_id
  if (!accountId || !fields.x_signature) return json({ ok: false }, 401)

  const db = adminClient()
  // 1) Cuenta por x_account_id (solo lectura).
  const { data: account, error: accountError } = await db.rpc('gateway_account_by_external_id', { p_gateway_account_id: accountId })
  if (accountError) return json({ ok: false }, 500)
  const acc = account as { id: string; provider: string; gateway_secret_name: string } | null
  if (!acc || acc.provider !== 'tuu') return json({ ok: false }, 401)
  const secret = isGatewaySecretName(acc.gateway_secret_name) ? Deno.env.get(acc.gateway_secret_name) : undefined
  // Sin clave configurada no se puede autenticar: 503 (TUU reintenta) y nada se escribe.
  if (!secret) return json({ ok: false, reason: 'gateway_not_configured' }, 503)

  // 2) Firma.
  if (!(await verifyTuuSignature(fields, secret))) return json({ ok: false }, 401)

  // 3) Autenticado: recién ahora se busca el pago o se registran incidentes.
  const reference = fields.x_reference ?? ''
  const { x_signature: _omit, ...payload } = fields
  const { data: payment, error: paymentError } = await db.rpc('gateway_payment_for_account', { p_reference: reference, p_account_id: acc.id })
  if (paymentError) return json({ ok: false }, 500)
  if (!payment) {
    await db.rpc('record_unknown_gateway_payment', { p_provider: 'tuu', p_reference: reference, p_detail: payload })
    return json({ ok: false, reason: 'unknown_payment' }, 404)
  }

  const status = tuuResult(fields.x_result)
  if (status === 'pending') return json({ ok: true, outcome: 'pending' })
  if (!status) return json({ ok: false, reason: 'unknown_result' }, 400)

  const { data, error } = await db.rpc('confirm_payment', {
    p_provider: 'tuu',
    p_provider_payment_id: reference,
    p_status: status,
    p_amount_clp: tuuAmount(fields.x_amount),
    p_payload: payload,
  })
  if (error) {
    console.error(JSON.stringify({ evento: 'payment-webhook-error', proveedor: 'tuu', codigo: error.code }))
    return json({ ok: false }, 500)
  }
  const outcome = (data as { outcome?: string })?.outcome
  console.log(JSON.stringify({ evento: 'payment-webhook', proveedor: 'tuu', resultado: outcome }))
  return json({ ok: true, outcome })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405)
  const name = new URL(req.url).pathname.split('/').filter(Boolean).at(-1)

  if (name === 'tuu') return handleTuu(req)

  // Pasarela simulada (solo local; getProvider la rechaza fuera de la pila local).
  const provider = getProvider(
    {
      SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
      SITE_URL: Deno.env.get('SITE_URL'),
      MOCK_WEBHOOK_SECRET: Deno.env.get('MOCK_WEBHOOK_SECRET'),
    },
    name,
  )
  if (!provider) return json({ ok: false }, 404)

  const event = await provider.verifyWebhook(req)
  if (!event) return json({ ok: false, reason: 'invalid_signature' }, 401)

  const { data, error } = await adminClient().rpc('confirm_payment', {
    p_provider: provider.name,
    p_provider_payment_id: event.providerPaymentId,
    p_status: event.status,
    p_amount_clp: event.amountClp,
    p_payload: event.raw,
  })
  if (error) {
    console.error(JSON.stringify({ evento: 'payment-webhook-error', codigo: error.code }))
    return json({ ok: false }, 500)
  }
  console.log(JSON.stringify({ evento: 'payment-webhook', proveedor: provider.name, resultado: (data as { outcome?: string })?.outcome }))
  return json({ ok: true, outcome: (data as { outcome?: string })?.outcome })
})
