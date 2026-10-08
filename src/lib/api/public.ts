import { supabase } from '../supabase'
import type {
  LegalKind,
  PublicBookingStatus,
  PublicLegalDocument,
  PublicProperty,
  PublicPropertyDetail,
  PublicSettings,
} from '../../types/public'
import type { Day } from '../dates/day'
import type { OccupiedRange } from '../calendar/availability'
import type { Quote } from '../pricing'

// Lectura pública: SOLO vistas public_* y app_settings (filas públicas).
// Nunca tablas base (Sesión 3: el público no tiene permisos sobre ellas).

const PHOTO_BUCKET = 'property-photos'

type PropertyRow = Omit<PublicProperty, 'cover'>

interface PhotoRow {
  property_id: string
  storage_path: string
  alt_text: string | null
}

export async function fetchPublicProperties(): Promise<PublicProperty[]> {
  const [properties, covers] = await Promise.all([
    supabase.from('public_properties').select('*').order('name'),
    supabase.from('public_property_photos').select('property_id, storage_path, alt_text').eq('is_cover', true),
  ])

  if (properties.error) throw properties.error
  if (covers.error) throw covers.error

  const coverByProperty = new Map(
    (covers.data as PhotoRow[]).map((photo) => [
      photo.property_id,
      { url: photoUrl(photo.storage_path), alt: photo.alt_text },
    ]),
  )

  return (properties.data as PropertyRow[]).map((row) => ({
    ...row,
    cover: coverByProperty.get(row.id) ?? null,
  }))
}

function photoUrl(storagePath: string): string {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl
}

// Ficha: null si no existe o no está publicada (la vista no distingue, y
// el sitio tampoco debe revelar si hay un borrador con ese slug).
export async function fetchPublicProperty(slug: string): Promise<PublicPropertyDetail | null> {
  const { data: row, error } = await supabase.from('public_properties').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  if (!row) return null

  const photos = await supabase
    .from('public_property_photos')
    .select('storage_path, alt_text, is_cover, sort_order')
    .eq('property_id', row.id)
    .order('is_cover', { ascending: false })
    .order('sort_order')
  if (photos.error) throw photos.error

  const list = photos.data.map((p) => ({ url: photoUrl(p.storage_path), alt: p.alt_text as string | null }))
  return { property: { ...(row as PropertyRow), cover: list[0] ?? null }, photos: list }
}

// Rangos ocupados [start, end) de una propiedad publicada, ya unidos por la
// base (sin tipo, huésped ni canal). Ventana: ver AVAILABILITY_WINDOW_DAYS.
export async function fetchAvailability(slug: string, from: Day, to: Day): Promise<OccupiedRange[]> {
  const { data, error } = await supabase.rpc('get_property_availability', { p_slug: slug, p_from: from, p_to: to })
  if (error) throw error
  return (data as { start_date: Day; end_date: Day }[]).map((r) => ({ start: r.start_date, end: r.end_date }))
}

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [
      'site_name',
      'whatsapp_number',
      'whatsapp_message',
      'booking_mode',
      'cancellation_free_days',
      'cancellation_refund_percent',
    ])

  if (error) throw error

  const value = (key: string) => data.find((row) => row.key === key)?.value ?? ''
  const int = (key: string, fallback: number) => {
    const n = Number.parseInt(value(key), 10)
    return Number.isInteger(n) && n >= 0 ? n : fallback
  }
  return {
    siteName: value('site_name'),
    whatsappNumber: value('whatsapp_number'),
    whatsappMessage: value('whatsapp_message'),
    // Ante cualquier duda, WhatsApp (el modo seguro).
    bookingMode: value('booking_mode') === 'online' ? 'online' : 'whatsapp',
    cancellationFreeDays: int('cancellation_free_days', 5),
    cancellationRefundPercent: Math.min(100, int('cancellation_refund_percent', 100)),
  }
}

// Versión vigente (la más reciente publicada) de un documento legal.
export async function fetchLegalDocument(kind: LegalKind): Promise<PublicLegalDocument | null> {
  const { data, error } = await supabase
    .from('public_legal_documents')
    .select('kind, version, title, content, published_at')
    .eq('kind', kind)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as PublicLegalDocument | null
}

// Estado público de una reserva por su código largo (sin datos personales).
export async function fetchBookingStatus(publicCode: string): Promise<PublicBookingStatus | null> {
  const { data, error } = await supabase.rpc('public_booking_status', { p_public_code: publicCode })
  if (error) throw error
  return (data as PublicBookingStatus | null) ?? null
}

// Cotización pública: solo precios finales (quote_stay no devuelve impuestos).
export async function quoteStay(slug: string, checkIn: Day, checkOut: Day, guests: number): Promise<Quote> {
  const { data, error } = await supabase.rpc('quote_stay', {
    p_slug: slug,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_guests: guests,
  })
  if (error) throw error
  return data as Quote
}
