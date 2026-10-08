// Validación de la solicitud de reserva (create-booking). Pura y probada
// (booking-input.test.ts). El formulario usa las mismas reglas para mostrar
// errores por campo antes de enviar; el servidor las vuelve a aplicar.

import { formatRut } from './rut.ts'

export type FieldError =
  | 'required'
  | 'invalid'
  | 'too_long'
  | 'invalid_email'
  | 'invalid_phone'
  | 'invalid_rut'
  | 'must_accept'

export interface BookingRequest {
  slug: string
  check_in: string
  check_out: string
  guests: number
  name: string
  email: string
  phone: string
  country: string
  invoice: {
    requested: boolean
    rut?: string
    business_name?: string
    activity?: string
    address?: string
  }
  accept_terms: boolean
  turnstile_token: string
  // Solo para comparar con el total del servidor (nunca se cobra este valor).
  expected_total_clp: number
}

export type ValidationResult =
  | { ok: true; value: BookingRequest }
  | { ok: false; errors: Partial<Record<string, FieldError>> }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function validDay(value: string): boolean {
  if (!DAY.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function validateBookingRequest(raw: unknown): ValidationResult {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: Partial<Record<string, FieldError>> = {}
  const text = (key: string, max: number, min = 1) => {
    const value = str(input[key])
    if (value.length < min) errors[key] = 'required'
    else if (value.length > max) errors[key] = 'too_long'
    return value
  }

  const slug = str(input.slug)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) errors.slug = 'invalid'

  const checkIn = str(input.check_in)
  const checkOut = str(input.check_out)
  if (!validDay(checkIn)) errors.check_in = 'invalid'
  if (!validDay(checkOut) || (validDay(checkIn) && checkOut <= checkIn)) errors.check_out = 'invalid'

  const guests = Number(input.guests)
  if (!Number.isInteger(guests) || guests < 1 || guests > 20) errors.guests = 'invalid'

  const name = text('name', 100, 2)
  const email = text('email', 254)
  if (email && !errors.email && !EMAIL.test(email)) errors.email = 'invalid_email'

  const phone = text('phone', 30)
  const phoneDigits = phone.replace(/[\s().-]/g, '')
  if (phone && !errors.phone && !/^\+?\d{8,15}$/.test(phoneDigits)) errors.phone = 'invalid_phone'

  const country = text('country', 60, 2)

  const rawInvoice = (input.invoice && typeof input.invoice === 'object' ? input.invoice : {}) as Record<string, unknown>
  const invoiceRequested = rawInvoice.requested === true
  let invoice: BookingRequest['invoice'] = { requested: false }
  if (invoiceRequested) {
    const rutRaw = str(rawInvoice.rut)
    const rut = formatRut(rutRaw)
    if (!rutRaw) errors['invoice.rut'] = 'required'
    else if (!rut) errors['invoice.rut'] = 'invalid_rut'
    const field = (key: 'business_name' | 'activity' | 'address', max: number, min: number) => {
      const value = str(rawInvoice[key])
      if (value.length < min) errors[`invoice.${key}`] = 'required'
      else if (value.length > max) errors[`invoice.${key}`] = 'too_long'
      return value
    }
    invoice = {
      requested: true,
      rut: rut ?? rutRaw,
      business_name: field('business_name', 150, 2),
      activity: field('activity', 150, 2),
      address: field('address', 200, 5),
    }
  }

  if (input.accept_terms !== true) errors.accept_terms = 'must_accept'

  const token = str(input.turnstile_token)
  if (!token) errors.turnstile_token = 'required'

  const expected = Number(input.expected_total_clp)
  if (!Number.isInteger(expected) || expected < 0) errors.expected_total_clp = 'invalid'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      slug,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      name,
      email: email.toLowerCase(),
      phone: phoneDigits,
      country,
      invoice,
      accept_terms: true,
      turnstile_token: token,
      expected_total_clp: expected,
    },
  }
}
