// Adaptador TUU Pago Online (https://developers.tuu.cl/docs/payment-intent).
// Firma x_signature: HMAC-SHA256 (hex en minúsculas) con la clave secreta de
// la cuenta, sobre los campos x_* (sin x_signature) ordenados por nombre
// (orden ASCII), concatenando nombre + valor sin separadores (un campo vacío
// aporta solo su nombre). El callback (POST form-urlencoded) es la ÚNICA
// fuente de verdad; las redirecciones del navegador no cambian estados.

import { hmacHex, safeEqual } from './mock.ts'
import type { ChargeRequest, ChargeResult, PaymentProvider } from './provider.ts'

export const TUU_ENDPOINTS = {
  integration: 'https://frontend-api.payment.haulmer.dev/v1/payment',
  production: 'https://core.payment.haulmer.com/api/v1/payment',
} as const

export type TuuEnvironment = keyof typeof TUU_ENDPOINTS

// Cadena firmada: solo x_*, sin x_signature, orden ASCII, nombre+valor.
export function tuuSigningString(fields: Record<string, string | number | null | undefined>): string {
  return Object.keys(fields)
    .filter((key) => key.startsWith('x_') && key !== 'x_signature')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${key}${fields[key] ?? ''}`)
    .join('')
}

export function tuuSignature(fields: Record<string, string | number | null | undefined>, secret: string): Promise<string> {
  return hmacHex(secret, tuuSigningString(fields))
}

// Verificación en tiempo constante. Sin firma o sin clave → inválido.
export async function verifyTuuSignature(fields: Record<string, string>, secret: string): Promise<boolean> {
  const given = (fields.x_signature ?? '').toLowerCase()
  if (!secret || !/^[0-9a-f]{64}$/.test(given)) return false
  return safeEqual(given, await tuuSignature(fields, secret))
}

export function parseTuuCallback(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(body)) fields[key] = value
  return fields
}

// x_result → estado normalizado (pending = esperar, no cambia nada).
export function tuuResult(value: string | undefined): 'approved' | 'rejected' | 'pending' | null {
  return value === 'completed' ? 'approved' : value === 'failed' ? 'rejected' : value === 'pending' ? 'pending' : null
}

// "19990" o "19990.00" → 19990; cualquier otra cosa → null (monto distinto).
export function tuuAmount(value: string | undefined): number | null {
  if (!value || !/^\d+(\.0+)?$/.test(value)) return null
  return Number.parseInt(value, 10)
}

// La respuesta de creación no está documentada: se aceptan las formas
// habituales y se confirma contra el sandbox.
function paymentUrlFrom(data: unknown): string | null {
  const d = data as Record<string, unknown> | null
  const candidates = [d?.url, d?.payment_url, d?.redirect_url, d?.link, (d?.data as Record<string, unknown> | undefined)?.url]
  const url = candidates.find((c) => typeof c === 'string' && /^https:\/\//.test(c as string))
  return (url as string | undefined) ?? null
}

interface TuuConfig {
  accountId: string
  secret: string
  environment: TuuEnvironment
  shopName?: string
  fetchImpl?: typeof fetch
}

export function createTuuProvider(config: TuuConfig): PaymentProvider {
  const fetchImpl = config.fetchImpl ?? fetch
  return {
    name: 'tuu',

    async createCharge(request: ChargeRequest): Promise<ChargeResult> {
      const [first, ...rest] = (request.customer?.name ?? '').trim().split(/\s+/)
      const fields: Record<string, string | number> = {
        x_account_id: config.accountId,
        x_amount: request.amountClp,
        x_currency: 'CLP',
        x_customer_email: request.customer?.email ?? '',
        x_customer_first_name: first ?? '',
        x_customer_last_name: rest.join(' '),
        x_customer_phone: request.customer?.phone ?? '',
        x_description: request.description,
        x_reference: request.paymentId,
        x_shop_name: config.shopName ?? 'Reservas UP',
        x_url_callback: request.webhookUrl,
        x_url_cancel: request.returnUrl,
        x_url_complete: request.returnUrl,
      }
      const body = { ...fields, x_signature: await tuuSignature(fields, config.secret) }
      const response = await fetchImpl(TUU_ENDPOINTS[config.environment], {
        method: 'POST',
        // TUU responde los errores de validación con un 302 a x_url_complete
        // (x_result=failed): no se sigue, se informa como error.
        redirect: 'manual',
        headers: { 'X-REDIRECT': 'false', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') ?? ''
        const message = location ? new URL(location).searchParams.get('x_message') : null
        throw new Error(`tuu rechazó el cobro: ${message ?? response.status}`)
      }
      const text = await response.text()
      let data: unknown = null
      try {
        data = JSON.parse(text)
      } catch {
        data = { url: text.trim() }
      }
      const paymentUrl = response.ok ? paymentUrlFrom(data) : null
      if (!paymentUrl) throw new Error(`tuu ${response.status}`)
      return { providerPaymentId: request.paymentId, paymentUrl }
    },

    // TUU se verifica en payment-webhook (necesita la clave de la cuenta,
    // que se busca por x_account_id antes de tocar la base).
    async verifyWebhook() {
      return null
    },

    async refund() {
      // Reembolsos: Sesión 15.
      return { ok: false }
    },
  }
}
