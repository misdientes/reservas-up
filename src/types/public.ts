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
}
