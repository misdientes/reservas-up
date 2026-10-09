import type { PaymentMethod, PaymentPlanQuote, PublicSettings } from '../types/public'

// Plazos de pago: siempre en hora de Chile, con día y hora
// ("viernes 27 de noviembre, 15:00"), sin importar dónde esté el huésped.
const deadlineFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDeadline(iso: string): string {
  const parts = Object.fromEntries(deadlineFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return `${parts.weekday} ${parts.day} de ${parts.month}, ${parts.hour}:${parts.minute}`
}

// WhatsApp con un mensaje propio (sin el saludo general de app_settings):
// comprobantes y pedidos de link llevan el código corto de la reserva.
export function whatsappMessageUrl(settings: PublicSettings | null, text: string): string | null {
  const digits = settings?.whatsappNumber.replace(/\D/g, '') ?? ''
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null
}

// Abono disponible (también con tarjeta desde la Sesión 10b) si el saldo
// alcanza a vencer después del plazo de pago (el servidor decide requires_full).
export function depositAvailable(plan: PaymentPlanQuote, _method: PaymentMethod): boolean {
  return !plan.requires_full && (plan.deposit_clp ?? 0) < (plan.total_clp ?? 0)
}
