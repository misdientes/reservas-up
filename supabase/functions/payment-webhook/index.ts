// Edge Function payment-webhook: recibe el aviso de pago del proveedor.
//   POST /functions/v1/payment-webhook/<proveedor>
// Es lo ÚNICO que confirma una reserva (CLAUDE.md §5). El aviso se verifica
// con el adaptador del proveedor (firma) y se aplica con confirm_payment,
// que es idempotente: el mismo aviso N veces no duplica nada.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getProvider } from '../_shared/payments/provider.ts'
import { json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405)

  const name = new URL(req.url).pathname.split('/').filter(Boolean).at(-1)
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

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.rpc('confirm_payment', {
    p_provider: provider.name,
    p_provider_payment_id: event.providerPaymentId,
    p_status: event.status,
    p_amount_clp: event.amountClp,
    p_payload: event.raw,
  })
  if (error) {
    console.error(JSON.stringify({ evento: 'payment-webhook-error', codigo: error.code }))
    // 500: el proveedor reintentará (confirm_payment es idempotente).
    return json({ ok: false }, 500)
  }
  console.log(JSON.stringify({ evento: 'payment-webhook', proveedor: provider.name, resultado: (data as { outcome?: string })?.outcome }))
  return json({ ok: true, outcome: (data as { outcome?: string })?.outcome })
})
