// Pagos desacoplados del proveedor (CLAUDE.md §5). Una interfaz única y un
// adaptador por proveedor. El proveedor activo se elige por configuración
// (secreto PAYMENT_PROVIDER), no cambiando código. Los reales (MercadoPago,
// TUU, Flow) se conectan en la Sesión 10 implementando esta interfaz.

import { createMockProvider } from './mock.ts'

export type ProviderName = 'mock' | 'mercadopago' | 'tuu' | 'flow'

export interface ChargeRequest {
  reservationId: string
  publicCode: string
  amountClp: number
  description: string
  // Adónde vuelve el navegador (solo informativo: NO confirma nada).
  returnUrl: string
  // Adónde el proveedor envía el aviso de pago (lo único que confirma).
  webhookUrl: string
}

export interface ChargeResult {
  providerPaymentId: string
  paymentUrl: string
}

// Estado normalizado de un aviso de pago verificado.
export type PaymentEventStatus = 'approved' | 'rejected' | 'abandoned'

export interface VerifiedPaymentEvent {
  providerPaymentId: string
  status: PaymentEventStatus
  amountClp: number | null
  raw: unknown
}

export interface PaymentProvider {
  name: ProviderName
  createCharge(request: ChargeRequest): Promise<ChargeResult>
  // Verifica la autenticidad del aviso (firma) y lo normaliza. null = inválido.
  verifyWebhook(request: Request): Promise<VerifiedPaymentEvent | null>
  refund(providerPaymentId: string, amountClp: number): Promise<{ ok: boolean; reference?: string }>
}

export interface ProviderEnv {
  PAYMENT_PROVIDER?: string
  SUPABASE_URL?: string
  SITE_URL?: string
  MOCK_WEBHOOK_SECRET?: string
}

// ¿El backend es la copia local (Docker)? El proveedor simulado solo existe ahí.
export function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return ['127.0.0.1', 'localhost', 'kong', 'host.docker.internal'].includes(host)
  } catch {
    return false
  }
}

// Proveedor configurado, o null si no hay uno utilizable ("pagos no disponibles").
export function getProvider(env: ProviderEnv, name: string | undefined = env.PAYMENT_PROVIDER): PaymentProvider | null {
  switch (name) {
    case 'mock':
      // Candado 1 de 2: jamás fuera de la base local (el 2.º está en la base).
      if (!isLocalSupabase(env.SUPABASE_URL)) return null
      return createMockProvider(env)
    // 'mercadopago' | 'tuu' | 'flow': Sesión 10.
    default:
      return null
  }
}
