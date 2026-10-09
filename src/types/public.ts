// Datos públicos: solo lo que exponen las vistas public_* (Sesión 3).

export type PropertyType = 'departamento' | 'cabana' | 'casa'

// Fila de public_properties + su foto de portada (si existe).
export interface PublicProperty {
  id: string
  slug: string
  name: string
  description: string | null
  city: string
  region: string | null
  neighborhood: string | null
  max_guests: number | null
  bedrooms: number | null
  beds: number | null
  bathrooms: number | null
  amenities: string[]
  house_rules: string | null
  check_in_time: string | null
  check_out_time: string | null
  min_nights: number
  property_type: PropertyType
  self_check_in: boolean
  min_advance_hours: number
  // Menor precio por noche (final) de los próximos 90 días; null = sin tarifa.
  price_from_clp: number | null
  cover: PublicPhoto | null
}

// Ficha completa: la propiedad y todas sus fotos en orden.
export interface PublicPropertyDetail {
  property: PublicProperty
  photos: PublicPhoto[]
}

export interface PublicPhoto {
  url: string
  alt: string | null
}

// Claves públicas de app_settings que usa el sitio.
export interface PublicSettings {
  siteName: string
  whatsappNumber: string
  whatsappMessage: string
  // 'online' = Reservar y pagar; cualquier otro valor = consultar por WhatsApp.
  bookingMode: 'online' | 'whatsapp'
  // Política de cancelación vigente (la reserva congela la suya al crearse).
  cancellationFreeDays: number
  cancellationRefundPercent: number
}

export type LegalKind = 'terminos' | 'privacidad' | 'cancelacion'

export interface PublicLegalDocument {
  kind: LegalKind
  version: string
  title: string
  content: string
  published_at: string
}

// Estado público de una reserva (public_booking_status): sin datos del huésped.
export type BookingStatusKind = 'procesando' | 'esperando_pago' | 'confirmada' | 'no_completada' | 'en_revision'

export type PaymentMethod = 'bank_transfer' | 'payment_link' | 'gateway'
export type PaymentPlan = 'deposit' | 'full'
export type PaymentState = 'esperando_pago' | 'vencida' | 'abonada' | 'pagada' | 'saldo_vencido' | 'reembolso_pendiente' | 'sin_pago'

// Plan de pago de una estadía (quote_payment_plan): solo precios finales.
export interface PaymentPlanQuote {
  quotable: boolean
  reason?: string
  total_clp?: number
  deposit_clp?: number
  balance_clp?: number
  requires_full?: boolean
  balance_due_at?: string
  manual_payment_window_hours?: number
  allowed_payment_methods?: PaymentMethod[]
  cancellation_free_days?: number
  cancellation_refund_percent?: number
}

// Datos de transferencia: solo llegan con el enlace secreto de la reserva.
export interface BankDetails {
  bank_name: string | null
  account_type: string | null
  account_number: string | null
  holder_name: string | null
  holder_rut: string | null
  holder_email: string | null
}

export interface BookingPayment {
  mode: 'gateway' | 'manual'
  method?: PaymentMethod
  plan?: PaymentPlan
  state: PaymentState
  deposit_clp?: number
  amount_paid: number
  balance_clp: number
  balance_due_at?: string
  pay_now_clp: number
  expires_at?: string
  bank?: BankDetails
}

export interface PublicBookingStatus {
  status: BookingStatusKind
  code: string
  property_name: string
  property_slug: string
  check_in: string
  check_out: string
  nights: number
  guests: number
  total_clp: number
  payment?: BookingPayment
}
