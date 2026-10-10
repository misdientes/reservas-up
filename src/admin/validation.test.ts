import { describe, expect, it } from 'vitest'
import { slugify, validateAccount, validateOwner, validatePropertyPublic } from './validation'

describe('panel: propiedades', () => {
  it('slug a partir del nombre (sin tildes ni símbolos)', () => {
    expect(slugify('Departamento Cavancha N°1 · Vista al mar')).toBe('departamento-cavancha-n-1-vista-al-mar')
    expect(slugify('Cabaña La Huayca')).toBe('cabana-la-huayca')
  })

  it('marca cada campo inválido', () => {
    expect(validatePropertyPublic({ name: 'X', slug: 'Mal Slug', city: '', max_guests: 40, min_nights: 0, min_advance_hours: 1000, description: null }))
      .toEqual({ name: 'required', slug: 'invalid', city: 'required', max_guests: 'range', min_nights: 'range', min_advance_hours: 'range' })
    expect(validatePropertyPublic({ name: 'Iquique 1', slug: 'iquique-1', city: 'Iquique', max_guests: '4', min_nights: '2', min_advance_hours: '24', description: 'x' }))
      .toEqual({})
  })
})

describe('panel: dueños', () => {
  it('RUT con dígito verificador (y lo deja en formato canónico)', () => {
    expect(validateOwner({ legal_name: 'Inmobiliaria Test SpA', rut: '760864285', avaluo_rebate_rate: 0.11 })).toEqual({ rut_formatted: '76.086.428-5' })
    expect(validateOwner({ legal_name: 'Test', rut: '76.086.428-4', avaluo_rebate_rate: 0.11 }).rut).toBe('invalid_rut')
    expect(validateOwner({ legal_name: 'T', rut: '1', avaluo_rebate_rate: 2 })).toMatchObject({ legal_name: 'required', rut: 'invalid_rut', avaluo_rebate_rate: 'range' })
  })
})

describe('panel: cuentas de cobro', () => {
  it('TUU exige código de comercio y nombre de secreto con prefijo (nunca la clave)', () => {
    expect(validateAccount({ label: 'Cuenta UP', provider: 'tuu', gateway_account_id: '', gateway_secret_name: 'mi-clave-secreta', holder_rut: '' }))
      .toEqual({ gateway_account_id: 'required', gateway_secret_name: 'secret_name' })
    expect(validateAccount({ label: 'Cuenta UP', provider: 'tuu', gateway_account_id: '123', gateway_secret_name: 'SUPABASE_SERVICE_ROLE_KEY', holder_rut: '' }).gateway_secret_name)
      .toBe('secret_name')
    expect(validateAccount({ label: 'Cuenta UP', provider: 'tuu', gateway_account_id: '123', gateway_secret_name: 'TUU_SECRET_UP', holder_rut: '76.086.428-5' })).toEqual({})
  })
})
