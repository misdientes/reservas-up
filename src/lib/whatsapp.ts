import type { PublicSettings } from '../types/public'
import { formatRange, type Day } from './dates/day'
import { t } from './i18n'

// Enlace wa.me con el número y el mensaje de app_settings (editables sin
// código). Sin número no hay enlace: el sitio oculta el botón.
export function whatsappUrl(settings: PublicSettings | null, extraText?: string): string | null {
  const digits = settings?.whatsappNumber.replace(/\D/g, '') ?? ''
  if (!digits) return null

  const message = [settings?.whatsappMessage, extraText].filter(Boolean).join(' ')
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`
}

// Datos de la consulta que se agregan al mensaje base de app_settings:
// "Me interesa Iquique 1, del 20 al 23 de noviembre, para 2 huéspedes."
export function stayMessage(stay: {
  propertyName: string
  llegada: Day | null
  salida: Day | null
  huespedes: number | null
}): string {
  const dates = stay.llegada && stay.salida ? formatRange(stay.llegada, stay.salida) : null
  return t.booking.whatsappStay(stay.propertyName, dates, stay.huespedes)
}
