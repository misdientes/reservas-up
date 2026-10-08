import { describe, expect, it } from 'vitest'
import { computeDv, formatRut, isValidRut } from './rut.ts'
import { validateBookingRequest } from './booking-input.ts'
import { getProvider, isLocalSupabase } from './payments/provider.ts'
import { createMockProvider, hmacHex, MOCK_SIGNATURE_HEADER } from './payments/mock.ts'

describe('RUT', () => {
  it.each([
    ['76.086.428-5', true],
    ['76086428-5', true],
    ['760864285', true],
    ['12.345.678-5', true],
    ['11.111.111-1', true],
    ['5.126.663-3', true],
    ['10.000.013-k', true], // K minúscula
    ['76.086.428-4', false], // dígito verificador incorrecto
    ['12.345.678-K', false],
    ['1-9', false], // demasiado corto
    ['abc', false],
    ['', false],
  ])('%s → %s', (rut, valid) => {
    expect(isValidRut(rut)).toBe(valid)
  })

  it('calcula el dígito verificador (0 y K incluidos)', () => {
    expect(computeDv('76086428')).toBe('5')
    expect(computeDv('10000013')).toBe('K')
    expect(computeDv('10000004')).toBe('0')
  })

  it('formatea al formato canónico', () => {
    expect(formatRut('760864285')).toBe('76.086.428-5')
    expect(formatRut('10000013-k')).toBe('10.000.013-K')
    expect(formatRut('76086428-4')).toBeNull()
  })
})

describe('validación de la solicitud de reserva', () => {
  const VALID = {
    slug: 'iquique-1', check_in: '2026-11-20', check_out: '2026-11-23', guests: 2,
    name: 'Ana Pérez', email: ' Ana@Example.CL ', phone: '+56 9 1234 5678', country: 'Chile',
    invoice: { requested: false }, accept_terms: true, turnstile_token: 'tok', expected_total_clp: 126000,
  }

  it('acepta una solicitud válida y normaliza email y teléfono', () => {
    const result = validateBookingRequest(VALID)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.email).toBe('ana@example.cl')
      expect(result.value.phone).toBe('+56912345678')
    }
  })

  it('marca cada campo inválido', () => {
    const result = validateBookingRequest({ ...VALID, email: 'x', phone: '12', check_out: '2026-11-20', accept_terms: false, name: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toMatchObject({
        email: 'invalid_email',
        phone: 'invalid_phone',
        check_out: 'invalid',
        accept_terms: 'must_accept',
        name: 'required',
      })
    }
  })

  it('factura: exige RUT válido y los datos de la empresa; formatea el RUT', () => {
    const missing = validateBookingRequest({ ...VALID, invoice: { requested: true, rut: '76.086.428-4' } })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.errors).toMatchObject({ 'invoice.rut': 'invalid_rut', 'invoice.business_name': 'required' })
    }
    const ok = validateBookingRequest({ ...VALID, invoice: { requested: true, rut: '760864285', business_name: 'Empresa SpA', activity: 'Servicios', address: 'Calle 123, Iquique' } })
    expect(ok.ok && ok.value.invoice.rut).toBe('76.086.428-5')
  })

  it('el monto esperado es obligatorio pero nunca se usa para cobrar (solo se compara)', () => {
    const result = validateBookingRequest({ ...VALID, expected_total_clp: -1 })
    expect(!result.ok && result.errors.expected_total_clp).toBe('invalid')
  })

  it('fechas imposibles', () => {
    expect(validateBookingRequest({ ...VALID, check_in: '2026-02-30' }).ok).toBe(false)
  })
})

describe('proveedor simulado: imposible fuera de la base local', () => {
  it('reconoce la base local', () => {
    expect(isLocalSupabase('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalSupabase('http://kong:8000')).toBe(true)
    expect(isLocalSupabase('https://ygsckeyfewlcitrwbywf.supabase.co')).toBe(false)
    expect(isLocalSupabase(undefined)).toBe(false)
  })

  it('getProvider("mock") en producción → null (pagos no disponibles)', () => {
    expect(getProvider({ PAYMENT_PROVIDER: 'mock', SUPABASE_URL: 'https://ygsckeyfewlcitrwbywf.supabase.co' })).toBeNull()
    expect(getProvider({ PAYMENT_PROVIDER: 'mock', SUPABASE_URL: 'http://kong:8000', MOCK_WEBHOOK_SECRET: 's' })?.name).toBe('mock')
    expect(getProvider({ SUPABASE_URL: 'http://kong:8000' })).toBeNull()
  })

  it('el webhook simulado exige la firma HMAC', async () => {
    const provider = createMockProvider({ MOCK_WEBHOOK_SECRET: 'secreto', SITE_URL: 'http://localhost:5174' })
    const body = JSON.stringify({ provider_payment_id: 'mock_1', status: 'approved', amount_clp: 76000 })
    const good = new Request('http://x', { method: 'POST', body, headers: { [MOCK_SIGNATURE_HEADER]: await hmacHex('secreto', body) } })
    const bad = new Request('http://x', { method: 'POST', body, headers: { [MOCK_SIGNATURE_HEADER]: await hmacHex('otro', body) } })
    expect(await provider.verifyWebhook(good)).toMatchObject({ providerPaymentId: 'mock_1', status: 'approved', amountClp: 76000 })
    expect(await provider.verifyWebhook(bad)).toBeNull()
  })
})
