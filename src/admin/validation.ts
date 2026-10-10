import { formatRut } from '../../supabase/functions/_shared/rut.ts'

// Validaciones del panel (puras; probadas en validation.test.ts). Son una
// ayuda para avisar antes de guardar: la base vuelve a validar todo.

export type Errors = Partial<Record<string, string>>

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

// "Departamento Cavancha 1" → "departamento-cavancha-1"
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const int = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v))

export function validatePropertyPublic(v: {
  name: string
  slug: string
  city: string
  max_guests: unknown
  min_nights: unknown
  min_advance_hours: unknown
  description: string | null
}): Errors {
  const e: Errors = {}
  if (v.name.trim().length < 2) e.name = 'required'
  if (!SLUG.test(v.slug)) e.slug = 'invalid'
  if (v.city.trim().length < 2) e.city = 'required'
  const guests = int(v.max_guests)
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 30)) e.max_guests = 'range'
  const nights = int(v.min_nights)
  if (nights === null || !Number.isInteger(nights) || nights < 1 || nights > 60) e.min_nights = 'range'
  const advance = int(v.min_advance_hours)
  if (advance === null || !Number.isInteger(advance) || advance < 0 || advance > 720) e.min_advance_hours = 'range'
  if ((v.description ?? '').length > 5000) e.description = 'too_long'
  return e
}

export function validateOwner(v: { legal_name: string; rut: string; avaluo_rebate_rate: unknown }): Errors & { rut_formatted?: string } {
  const e: Errors & { rut_formatted?: string } = {}
  if (v.legal_name.trim().length < 2) e.legal_name = 'required'
  const rut = formatRut(v.rut)
  if (!rut) e.rut = 'invalid_rut'
  else e.rut_formatted = rut
  const rate = Number(v.avaluo_rebate_rate)
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) e.avaluo_rebate_rate = 'range'
  return e
}

export const SECRET_NAME = /^(TUU|GATEWAY)_[A-Z0-9_]{2,60}$/

export function validateAccount(v: {
  label: string
  provider: string
  gateway_account_id: string
  gateway_secret_name: string
  holder_rut: string
}): Errors {
  const e: Errors = {}
  if (v.label.trim().length < 2) e.label = 'required'
  if (v.holder_rut.trim() && !formatRut(v.holder_rut)) e.holder_rut = 'invalid_rut'
  if (v.provider === 'tuu') {
    if (!v.gateway_account_id.trim()) e.gateway_account_id = 'required'
    if (!SECRET_NAME.test(v.gateway_secret_name)) e.gateway_secret_name = 'secret_name'
  } else if (v.gateway_secret_name && !SECRET_NAME.test(v.gateway_secret_name)) {
    e.gateway_secret_name = 'secret_name'
  }
  return e
}
