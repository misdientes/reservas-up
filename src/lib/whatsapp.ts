import type { PublicSettings } from '../types/public'

// Enlace wa.me con el número y el mensaje de app_settings (editables sin
// código). Sin número no hay enlace: el sitio oculta el botón.
export function whatsappUrl(settings: PublicSettings | null, extraText?: string): string | null {
  const digits = settings?.whatsappNumber.replace(/\D/g, '') ?? ''
  if (!digits) return null

  const message = [settings?.whatsappMessage, extraText].filter(Boolean).join(' ')
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`
}
