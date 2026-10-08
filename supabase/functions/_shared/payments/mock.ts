// Proveedor de pago SIMULADO (solo desarrollo y pruebas, solo en la base
// local). Imita a un proveedor real: crea un cobro con una URL de pasarela
// y luego envía un aviso de pago FIRMADO al webhook. La pasarela de prueba
// (/pasarela-prueba/:id) tiene botones Aprobar, Rechazar y Abandonar.

import type { PaymentProvider, ProviderEnv, VerifiedPaymentEvent } from './provider.ts'

const encoder = new TextEncoder()

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature'

export function createMockProvider(env: ProviderEnv): PaymentProvider {
  const secret = env.MOCK_WEBHOOK_SECRET ?? ''
  const siteUrl = (env.SITE_URL ?? 'http://localhost:5174').replace(/\/$/, '')

  return {
    name: 'mock',

    async createCharge(charge) {
      const providerPaymentId = `mock_${crypto.randomUUID()}`
      // ?reserva= permite a la pasarela de prueba mostrar el monto (estado público).
      return { providerPaymentId, paymentUrl: `${siteUrl}/pasarela-prueba/${providerPaymentId}?reserva=${charge.publicCode}` }
    },

    async verifyWebhook(request: Request): Promise<VerifiedPaymentEvent | null> {
      if (!secret) return null
      const body = await request.text()
      const signature = request.headers.get(MOCK_SIGNATURE_HEADER) ?? ''
      if (!safeEqual(signature, await hmacHex(secret, body))) return null
      try {
        const event = JSON.parse(body) as { provider_payment_id?: string; status?: string; amount_clp?: number | null }
        if (!event.provider_payment_id || !['approved', 'rejected', 'abandoned'].includes(event.status ?? '')) return null
        return {
          providerPaymentId: event.provider_payment_id,
          status: event.status as VerifiedPaymentEvent['status'],
          amountClp: typeof event.amount_clp === 'number' ? event.amount_clp : null,
          raw: event,
        }
      } catch {
        return null
      }
    },

    async refund(providerPaymentId: string) {
      return { ok: true, reference: `mock-refund-${providerPaymentId}` }
    },
  }
}
