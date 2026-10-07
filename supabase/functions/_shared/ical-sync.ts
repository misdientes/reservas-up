// Sincronización de calendarios externos (importación). La usan:
//  * la Edge Function ical-import (cron cada 10 min: todos los calendarios);
//  * el checkout de la Sesión 9: syncProperty(propertyId) revalida la
//    propiedad justo antes de cobrar (CLAUDE.md §4, regla 3).
// La URL de importación es secreta: nunca se registra ni se devuelve.

import { fetchCalendar, parseCalendar, todayInChile } from './ical.ts'

// Cliente mínimo (supabase-js con service role) para no acoplarse a la librería.
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

interface CalendarRow {
  id: string
  property_id: string
  channel: string
  import_url: string
}

export interface CalendarSyncResult {
  calendar_id: string
  property_id: string
  channel: string
  ok: boolean
  error?: string
  summary?: unknown
}

async function syncOne(db: RpcClient, calendar: CalendarRow, allowedHosts: string): Promise<CalendarSyncResult> {
  const base = { calendar_id: calendar.id, property_id: calendar.property_id, channel: calendar.channel }

  const download = await fetchCalendar(calendar.import_url, allowedHosts)
  const parsed = download.ok ? parseCalendar(download.text, todayInChile()) : null
  const ok = download.ok && parsed !== null && parsed.ok
  const error = !download.ok ? download.error : parsed && !parsed.ok ? parsed.error : undefined

  // Si algo falló, apply_ical_import recibe ok=false y NO toca ninguna ocupación.
  const { data, error: rpcError } = await db.rpc('apply_ical_import', {
    p_calendar_id: calendar.id,
    p_ok: ok,
    p_events: ok && parsed && parsed.ok ? parsed.events : null,
    p_error: ok ? null : error,
  })
  if (rpcError) return { ...base, ok: false, error: 'No se pudo aplicar la importación' }
  return ok ? { ...base, ok: true, summary: data } : { ...base, ok: false, error }
}

export async function syncCalendars(db: RpcClient, propertyId: string | null = null): Promise<CalendarSyncResult[]> {
  const [{ data: calendars, error }, { data: allowed }] = await Promise.all([
    db.rpc('ical_calendars_to_sync', { p_property_id: propertyId }),
    db.rpc('ical_allowed_hosts'),
  ])
  if (error) throw new Error('No se pudieron leer los calendarios')

  const results: CalendarSyncResult[] = []
  // De a uno: pocos calendarios y sin apuro; evita ráfagas a Airbnb/Booking.
  for (const calendar of (calendars as CalendarRow[]) ?? []) {
    const result = await syncOne(db, calendar, String(allowed ?? ''))
    // Registro sin la URL (secreta): solo el id del calendario y el resultado.
    console.log(JSON.stringify({ evento: 'ical-sync', calendario: result.calendar_id, ok: result.ok, error: result.error, resumen: result.summary }))
    results.push(result)
  }
  return results
}

// Sincroniza UNA propiedad a demanda (checkout, Sesión 9).
export function syncProperty(db: RpcClient, propertyId: string): Promise<CalendarSyncResult[]> {
  return syncCalendars(db, propertyId)
}
