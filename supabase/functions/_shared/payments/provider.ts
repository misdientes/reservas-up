// Pagos desacoplados del proveedor (CLAUDE.md §5). Una interfaz única y un
// adaptador por proveedor. Desde la Sesión 10b el proveedor y sus
// credenciales salen de la CUENTA de cobro de la propiedad
// (payment_accounts): nunca hay credenciales globales. TUU implementado;
// Flow y MercadoPago quedan como adaptadores futuros.

import { createMockProvider } from './mock.ts'
import { createTuuProvider, type TuuEnvironment } from './tuu.ts'

export type ProviderName = 'mock' | 'mercadopago' | 'tuu' | 'flow'

export interface ChargeRequest {
  // Id del pago (x_reference en TUU): único por cobro.
  paymentId: string
  reservationId: string
  publicCode: string
  amountClp: number
  description: string
  // Adónde vuelve el navegador (solo informativo: NO confirma nada).
  returnUrl: string
  // Adónde el proveedor envía el aviso de pago (lo único que confirma).
  webhookUrl: string
  customer?: { name?: string | null; email?: string | null; phone?: string | null }
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

// Cuenta de cobro (de create_gateway_payment). La clave NUNCA está aquí:
// solo el nombre del secreto de Supabase que la guarda.
export interface GatewayAccount {
  provider: string | null
  gateway_account_id: string | null
  gateway_environment: string | null
  gateway_secret_name: string | null
}

// Solo estos nombres pueden leerse como clave de pasarela: una fila mal
// cargada no puede apuntar a otro secreto (por ejemplo, el de service_role).
export function isGatewaySecretName(name: string | null | undefined): name is string {
  return typeof name === 'string' && /^(TUU|GATEWAY)_[A-Z0-9_]{2,60}$/.test(name)
}

// Proveedor de una cuenta de cobro, o null si no hay uno utilizable.
export function getAccountProvider(
  account: GatewayAccount,
  env: ProviderEnv,
  readSecret: (name: string) => string | undefined,
): PaymentProvider | null {
  if (account.provider === 'mock') return getProvider(env, 'mock')
  if (account.provider === 'tuu') {
    const environment = account.gateway_environment as TuuEnvironment
    if (!account.gateway_account_id || !['integration', 'production'].includes(environment)) return null
    if (!isGatewaySecretName(account.gateway_secret_name)) return null
    const secret = readSecret(account.gateway_secret_name)
    if (!secret) return null
    return createTuuProvider({ accountId: account.gateway_account_id, secret, environment })
  }
  return null
}

// Proveedor por nombre (solo el simulado: su webhook se verifica con
// MOCK_WEBHOOK_SECRET). null = "pagos no disponibles".
export function getProvider(env: ProviderEnv, name: string | undefined = env.PAYMENT_PROVIDER): PaymentProvider | null {
  switch (name) {
    case 'mock':
      // Candado 1 de 2: jamás fuera de la base local (el 2.º está en la base).
      if (!isLocalSupabase(env.SUPABASE_URL)) return null
      return createMockProvider(env)
    // TUU: por cuenta (getAccountProvider). Flow y MercadoPago: futuros.
    default:
      return null
  }
}
