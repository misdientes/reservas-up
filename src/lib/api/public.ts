import { supabase } from '../supabase'
import type { PublicProperty, PublicSettings } from '../../types/public'

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
      {
        url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl,
        alt: photo.alt_text,
      },
    ]),
  )

  return (properties.data as PropertyRow[]).map((row) => ({
    ...row,
    cover: coverByProperty.get(row.id) ?? null,
  }))
}

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['site_name', 'whatsapp_number', 'whatsapp_message'])

  if (error) throw error

  const value = (key: string) => data.find((row) => row.key === key)?.value ?? ''
  return {
    siteName: value('site_name'),
    whatsappNumber: value('whatsapp_number'),
    whatsappMessage: value('whatsapp_message'),
  }
}
