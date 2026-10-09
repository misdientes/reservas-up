// Inicia un cobro por pasarela para una reserva: el monto lo decide la base
// (create_gateway_payment: abono, total o saldo) y el proveedor sale de la
// cuenta de cobro de la propiedad. Lo usan create-booking y pay-online.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getAccountProvider, type GatewayAccount, type ProviderEnv } from './provider.ts'

export type ChargeStart =
  | { ok: true; paymentUrl: string; amountClp: number; paymentId: string }
  | { ok: false; reason: string }

interface GatewayPayment {
  ok: boolean
  reason?: string
  payment_id: string
  // x_reference (24 hex): TUU acepta como máximo 26 caracteres.
  reference: string
  amount_clp: number
  public_code: string
  code: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  account: GatewayAccount
}

export async function startGatewayCharge(
  db: SupabaseClient,
  reservationId: string,
  // PAYMENT_WEBHOOK_BASE_URL: solo para pruebas locales con un túnel público
  // (el sandbox de TUU necesita llegar al webhook); en producción no se define.
  env: ProviderEnv & { SUPABASE_URL: string; SITE_URL: string; PAYMENT_WEBHOOK_BASE_URL?: string },
  readSecret: (name: string) => string | undefined,
): Promise<ChargeStart> {
  const { data, error } = await db.rpc('create_gateway_payment', { p_reservation_id: reservationId })
  if (error || !data) return { ok: false, reason: 'error' }
  const payment = data as GatewayPayment
  if (!payment.ok) return { ok: false, reason: payment.reason ?? 'error' }

  // El pago pendiente que no llega a la pasarela se anula (no bloquea reintentos).
  const voidPayment = () => db.from('payments').update({ status: 'anulado', note: 'no se pudo iniciar en la pasarela' }).eq('id', payment.payment_id)

  const provider = getAccountProvider(payment.account, env, readSecret)
  if (!provider) {
    await voidPayment()
    return { ok: false, reason: 'gateway_not_configured' }
  }
  const site = env.SITE_URL.replace(/\/$/, '')
  try {
    const charge = await provider.createCharge({
      paymentId: payment.reference,
      reservationId,
      publicCode: payment.public_code,
      amountClp: payment.amount_clp,
      description: `Reserva ${payment.code}`,
      returnUrl: `${site}/reserva/${payment.public_code}`,
      webhookUrl: `${(env.PAYMENT_WEBHOOK_BASE_URL ?? `${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1`).replace(/\/$/, '')}/payment-webhook/${provider.name}`,
      customer: { name: payment.contact_name, email: payment.contact_email, phone: payment.contact_phone },
    })
    return { ok: true, paymentUrl: charge.paymentUrl, amountClp: payment.amount_clp, paymentId: payment.payment_id }
  } catch (cause) {
    console.error(JSON.stringify({ evento: 'gateway-charge-error', proveedor: provider.name, detalle: cause instanceof Error ? cause.message : 'error' }))
    await voidPayment()
    return { ok: false, reason: 'payments_unavailable' }
  }
}
