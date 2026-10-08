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
export type BookingStatusKind = 'procesando' | 'confirmada' | 'no_completada' | 'en_revision'

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
}
