import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { ea } from '../lib/i18n/es-admin'

// Acceso a datos del panel. El admin escribe directo en las tablas (RLS de
// admin); la base valida todo (restricciones, triggers y funciones).

export const PHOTO_BUCKET = 'property-photos'

export interface PropertyRow {
  id: string
  owner_id: string
  rate_group_id: string | null
  payment_account_id: string | null
  slug: string
  name: string
  description: string | null
  city: string
  region: string | null
  neighborhood: string | null
  address: string | null
  max_guests: number | null
  bedrooms: number | null
  beds: number | null
  bathrooms: number | null
  check_in_time: string | null
  check_out_time: string | null
  min_nights: number
  min_advance_hours: number
  status: 'borrador' | 'publicada' | 'pausada'
  property_type: 'departamento' | 'cabana' | 'casa'
  self_check_in: boolean
  amenities: string[]
  house_rules: string | null
  first_published_at: string | null
  allowed_payment_methods: string[] | null
  deposit_percent: number | null
  deposit_min_nights: number | null
  manual_payment_window_hours: number | null
  balance_due_hours_before_checkin: number | null
  cancellation_free_days: number | null
  cancellation_refund_percent: number | null
  updated_at: string
}

export interface ArrivalInfoRow {
  property_id: string
  exact_address: string | null
  access_instructions: string | null
  wifi_name: string | null
  wifi_password: string | null
  parking: string | null
  notes: string | null
  updated_at: string
}

export interface PhotoRow {
  id: string
  property_id: string
  storage_path: string
  alt_text: string | null
  sort_order: number
  is_cover: boolean
}

export interface OwnerRow {
  id: string
  kind: 'empresa' | 'persona_natural'
  legal_name: string
  rut: string
  email: string | null
  phone: string | null
  vat_applies: boolean | null
  apply_avaluo_rebate: boolean
  avaluo_rebate_rate: number
  avaluo_rebate_mode: 'precio_fijo' | 'traspasar'
  notes: string | null
  updated_at: string
}

export interface AccountRow {
  id: string
  owner_id: string
  label: string
  provider: string | null
  bank_name: string | null
  account_type: string | null
  account_number: string | null
  holder_name: string | null
  holder_rut: string | null
  holder_email: string | null
  gateway_account_id: string | null
  gateway_environment: string | null
  gateway_secret_name: string | null
  is_active: boolean
  updated_at: string
}

export interface AccountSummary {
  id: string
  owner_id: string
  owner_name: string
  label: string
  provider: string | null
  bank_name: string | null
  account_number_masked: string | null
  is_active: boolean
  gateway_ready: boolean
  used_by: number
  updated_at: string
}

export interface RateGroupRow {
  id: string
  owner_id: string
  name: string
}

export interface AuditRow {
  id: number
  at: string
  actor: string | null
  table_name: string
  record_id: string | null
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_fields: string[]
}

// Error de la base → mensaje claro para René.
export function errorMessage(error: PostgrestError | null | undefined): string {
  if (!error) return ''
  return ea.errors[error.hint ?? ''] ?? (error.code === 'P0001' ? error.message : ea.errors[error.code ?? '']) ?? ea.common.genericError
}

export const isStale = (error: PostgrestError | null | undefined) => error?.code === '40001'

export function photoUrl(path: string): string {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function loadSettings(): Promise<Record<string, string>> {
  const { data } = await supabase.from('app_settings').select('key, value')
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
}
