import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTuuProvider, parseTuuCallback, tuuAmount, tuuResult, tuuSignature, tuuSigningString, verifyTuuSignature } from './tuu.ts'
import { getAccountProvider, isGatewaySecretName } from './provider.ts'

// Cálculo independiente (node:crypto) según la documentación de TUU.
const reference = (fields: Record<string, string>, secret: string) =>
  createHmac('sha256', secret)
    .update(
      Object.keys(fields)
        .filter((k) => k.startsWith('x_') && k !== 'x_signature')
        .sort()
        .map((k) => k + fields[k])
        .join(''),
      'utf8',
    )
    .digest('hex')

const SECRET = 'clave-de-prueba'
const callback = {
  x_account_id: 'ACC-1',
  x_amount: '40000',
  x_currency: 'CLP',
  x_message: 'Transacción aprobada',
  x_reference: '5c733500-a53f-4388-8929-8d1aedfaccc8',
  x_result: 'completed',
  x_timestamp: '2026-10-09T20:45:12',
}

describe('TUU: firma x_signature', () => {
  it('coincide con un cálculo independiente (orden ASCII, nombre+valor, UTF-8)', async () => {
    expect(await tuuSignature(callback, SECRET)).toBe(reference(callback, SECRET))
    expect(await tuuSignature(callback, SECRET)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('campo vacío aporta solo su nombre; ignora campos que no son x_ y la propia firma', () => {
    expect(tuuSigningString({ x_b: '2', x_a: '', otro: 'z', x_signature: 'abc' })).toBe('x_ax_b2')
  })

  it('verifica un callback válido y rechaza cualquier alteración', async () => {
    const signed = { ...callback, x_signature: reference(callback, SECRET) }
    expect(await verifyTuuSignature(signed, SECRET)).toBe(true)
    expect(await verifyTuuSignature({ ...signed, x_amount: '1' }, SECRET)).toBe(false)
    expect(await verifyTuuSignature({ ...signed, x_result: 'completed ' }, SECRET)).toBe(false)
    expect(await verifyTuuSignature(signed, 'otra-clave')).toBe(false)
    expect(await verifyTuuSignature({ ...callback, x_signature: '' }, SECRET)).toBe(false)
    expect(await verifyTuuSignature(signed, '')).toBe(false)
  })
})

describe('TUU: callback', () => {
  it('parsea form-urlencoded y normaliza resultado y monto', () => {
    const fields = parseTuuCallback('x_reference=abc&x_result=failed&x_message=Saldo+insuficiente&x_amount=19990.00')
    expect(fields).toMatchObject({ x_reference: 'abc', x_result: 'failed', x_message: 'Saldo insuficiente' })
    expect(tuuResult('completed')).toBe('approved')
    expect(tuuResult('failed')).toBe('rejected')
    expect(tuuResult('pending')).toBe('pending')
    expect(tuuResult('otro')).toBeNull()
    expect(tuuAmount('19990.00')).toBe(19990)
    expect(tuuAmount('19990')).toBe(19990)
    expect(tuuAmount('19990.5')).toBeNull()
    expect(tuuAmount('-1')).toBeNull()
  })
})

describe('TUU: crear el cobro', () => {
  it('envía los campos firmados al endpoint de integración y devuelve la URL', async () => {
    let sent: { url: string; body: Record<string, string | number>; headers: Record<string, string> } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> }
      return new Response(JSON.stringify({ url: 'https://pago.tuu.cl/x/123' }), { status: 200 })
    }) as unknown as typeof fetch
    const provider = createTuuProvider({ accountId: 'ACC-1', secret: SECRET, environment: 'integration', fetchImpl: fake })
    const charge = await provider.createCharge({
      paymentId: 'pay-1', reservationId: 'r', publicCode: 'p', amountClp: 35000, description: 'Reserva UP-1',
      returnUrl: 'https://reservas-up.pages.dev/reserva/p', webhookUrl: 'https://x.supabase.co/functions/v1/payment-webhook/tuu',
      customer: { name: 'Camila Rojas Soto', email: 'c@x.cl', phone: '+56911112222' },
    })
    expect(charge).toEqual({ providerPaymentId: 'pay-1', paymentUrl: 'https://pago.tuu.cl/x/123' })
    expect(sent!.url).toBe('https://frontend-api.payment.haulmer.dev/v1/payment')
    expect(sent!.headers['X-REDIRECT']).toBe('false')
    expect(sent!.body).toMatchObject({ x_reference: 'pay-1', x_amount: 35000, x_currency: 'CLP', x_customer_first_name: 'Camila', x_customer_last_name: 'Rojas Soto' })
    const { x_signature, ...fields } = sent!.body
    expect(x_signature).toBe(reference(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])), SECRET))
  })

  it('acepta la respuesta en texto plano (formato real del sandbox)', async () => {
    const fake = (async () => new Response('https://payment.haulmer.dev/secure/payment-intent/abc123', { status: 200 })) as unknown as typeof fetch
    const provider = createTuuProvider({ accountId: 'A', secret: SECRET, environment: 'integration', fetchImpl: fake })
    const charge = await provider.createCharge({ paymentId: 'p', reservationId: 'r', publicCode: 'c', amountClp: 1, description: 'd', returnUrl: 'u', webhookUrl: 'w' })
    expect(charge.paymentUrl).toBe('https://payment.haulmer.dev/secure/payment-intent/abc123')
  })

  it('un 302 de TUU (error de validación) es un error y no se sigue', async () => {
    let redirectMode: RequestRedirect | undefined
    const fake = (async (_url: string, init: RequestInit) => {
      redirectMode = init.redirect
      return new Response(null, { status: 302, headers: { location: 'https://reservas-up.pages.dev/r?x_result=failed&x_message=Error%20validacion' } })
    }) as unknown as typeof fetch
    const provider = createTuuProvider({ accountId: 'A', secret: SECRET, environment: 'integration', fetchImpl: fake })
    await expect(provider.createCharge({ paymentId: 'p', reservationId: 'r', publicCode: 'c', amountClp: 1, description: 'd', returnUrl: 'u', webhookUrl: 'w' })).rejects.toThrow('Error validacion')
    expect(redirectMode).toBe('manual')
  })

  it('una respuesta sin URL https es un error (no se envía al huésped a ningún lado)', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: 'x' }), { status: 400 })) as unknown as typeof fetch
    const provider = createTuuProvider({ accountId: 'A', secret: SECRET, environment: 'integration', fetchImpl: fake })
    await expect(provider.createCharge({ paymentId: 'p', reservationId: 'r', publicCode: 'c', amountClp: 1, description: 'd', returnUrl: 'u', webhookUrl: 'w' })).rejects.toThrow()
  })
})

describe('Credenciales por cuenta', () => {
  const account = { provider: 'tuu', gateway_account_id: 'ACC-1', gateway_environment: 'integration', gateway_secret_name: 'TUU_SECRET_UP' }
  const env = { SUPABASE_URL: 'https://ygsckeyfewlcitrwbywf.supabase.co' }

  it('lee solo la clave nombrada en la cuenta', () => {
    expect(getAccountProvider(account, env, (n) => (n === 'TUU_SECRET_UP' ? 'k' : undefined))?.name).toBe('tuu')
    expect(getAccountProvider(account, env, () => undefined)).toBeNull() // secreto sin crear
  })

  it('nunca lee secretos que no sean de pasarela', () => {
    expect(isGatewaySecretName('SUPABASE_SERVICE_ROLE_KEY')).toBe(false)
    expect(isGatewaySecretName('RESEND_API_KEY')).toBe(false)
    expect(getAccountProvider({ ...account, gateway_secret_name: 'SUPABASE_SERVICE_ROLE_KEY' }, env, () => 'x')).toBeNull()
  })

  it('el simulado sigue siendo imposible fuera de la base local', () => {
    expect(getAccountProvider({ ...account, provider: 'mock' }, env, () => 'x')).toBeNull()
  })
})
