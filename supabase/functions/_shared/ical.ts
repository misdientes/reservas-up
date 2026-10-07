// iCal (RFC 5545): lectura de calendarios de Airbnb/Booking/Google, descarga
// segura y generación del calendario que exportamos. TypeScript puro (sin
// APIs de Deno) para probarlo con vitest: supabase/functions/_shared/ical.test.ts.
//
// Reglas de seguridad (docs/ical.md):
//  * Un archivo que no es un VCALENDAR válido, o con un VEVENT que no se
//    entiende, es INVÁLIDO entero: no se aplica nada (no se libera ninguna
//    noche por un evento mal leído).
//  * Las fechas de estadía son días de Chile ("solo día", como en el frontend).
//  * Los mensajes de error nunca incluyen la URL (es secreta).

export type Day = string // YYYY-MM-DD

// MISMA ventana que get_property_availability y AVAILABILITY_WINDOW_DAYS del
// frontend (src/lib/calendar/availability.ts). Una prueba exige que coincidan.
export const ICAL_WINDOW_DAYS = 548
export const CHILE_TZ = 'America/Santiago'

export interface ImportedEvent {
  uid: string
  start: Day // primera noche
  end: Day // día de salida (exclusivo)
}

export type ParseResult = { ok: true; events: ImportedEvent[] } | { ok: false; error: string }

// ─── Días (aritmética de calendario, sin zona horaria) ───────────────────
const MS_PER_DAY = 86_400_000

function dayToMs(day: Day): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
}

export function addDays(day: Day, n: number): Day {
  return new Date(dayToMs(day) + n * MS_PER_DAY).toISOString().slice(0, 10)
}

function makeDay(y: number, m: number, d: number): Day | null {
  const ms = Date.UTC(y, m - 1, d)
  const day = new Date(ms).toISOString().slice(0, 10)
  // Rechaza fechas imposibles (20260230).
  return day === `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` ? day : null
}

function partsInZone(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') }
}

// Fecha de Chile de un instante.
export function chileDay(instant: number): Day {
  const p = partsInZone(instant, CHILE_TZ)
  return makeDay(p.y, p.m, p.d)!
}

export function todayInChile(now = Date.now()): Day {
  return chileDay(now)
}

// Hora de pared en una zona → instante (dos pasadas: cubre el cambio de horario).
function wallTimeToInstant(y: number, m: number, d: number, h: number, mi: number, s: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi, s)
  const offset = (instant: number) => {
    const p = partsInZone(instant, timeZone)
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - instant
  }
  let instant = guess - offset(guess)
  const second = offset(instant)
  if (guess - second !== instant) instant = guess - second
  return instant
}

// ─── Lectura ─────────────────────────────────────────────────────────────
interface Property {
  name: string
  params: Record<string, string>
  value: string
}

// Desdobla líneas (RFC 5545 §3.1): una línea que empieza con espacio o tab continúa la anterior.
export function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

function parseLine(line: string): Property | null {
  let inQuotes = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ':' && !inQuotes) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const [rawName, ...rawParams] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) }
}

type ParsedDate = { kind: 'date'; day: Day } | { kind: 'datetime'; day: Day }

// DTSTART/DTEND → día de Chile. null si no se puede interpretar.
function parseDate(prop: Property): ParsedDate | null {
  const v = prop.value.trim()
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (dateOnly) {
    const day = makeDay(+dateOnly[1], +dateOnly[2], +dateOnly[3])
    return day ? { kind: 'date', day } : null
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v)
  if (!dt) return null
  const [y, m, d, h, mi, s] = dt.slice(1, 7).map(Number)
  if (!makeDay(y, m, d) || h > 23 || mi > 59 || s > 60) return null
  try {
    if (dt[7] === 'Z') return { kind: 'datetime', day: chileDay(Date.UTC(y, m - 1, d, h, mi, s)) }
    if (prop.params.TZID) return { kind: 'datetime', day: chileDay(wallTimeToInstant(y, m, d, h, mi, s, prop.params.TZID)) }
  } catch {
    return null // TZID desconocido
  }
  // Hora "flotante" (sin zona): se interpreta como hora de Chile.
  return { kind: 'datetime', day: makeDay(y, m, d)! }
}

export function parseCalendar(text: string, today: Day): ParseResult {
  const lines = unfold(text.replace(/^\uFEFF/, '')).map((l) => l.trimEnd())
  const nonEmpty = lines.filter((l) => l.length > 0)
  if (nonEmpty[0]?.toUpperCase() !== 'BEGIN:VCALENDAR' || nonEmpty.at(-1)?.toUpperCase() !== 'END:VCALENDAR') {
    return { ok: false, error: 'El archivo no es un VCALENDAR válido' }
  }

  const windowEnd = addDays(today, ICAL_WINDOW_DAYS)
  const byUid = new Map<string, ImportedEvent>()
  let current: Property[] | null = null
  let nested = 0

  for (const line of nonEmpty) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      if (current) return { ok: false, error: 'VEVENT sin cerrar' }
      current = []
      continue
    }
    if (upper === 'END:VEVENT') {
      if (!current) return { ok: false, error: 'END:VEVENT sin BEGIN' }
      const result = eventFrom(current)
      current = null
      if ('error' in result) return { ok: false, error: result.error }
      if (result.skip) continue
      // Recorte a la ventana [hoy, hoy + 548): lo pasado y lo lejano no importan.
      const start = result.start < today ? today : result.start
      const end = result.end > windowEnd ? windowEnd : result.end
      if (start >= end) continue
      const existing = byUid.get(result.uid)
      // UID duplicado: se une en el rango que cubre ambos (lado seguro).
      byUid.set(
        result.uid,
        existing
          ? { uid: result.uid, start: existing.start < start ? existing.start : start, end: existing.end > end ? existing.end : end }
          : { uid: result.uid, start, end },
      )
      continue
    }
    if (!current) continue
    if (upper.startsWith('BEGIN:')) nested++
    else if (upper.startsWith('END:')) nested--
    else if (nested === 0) {
      const prop = parseLine(line)
      if (prop) current.push(prop)
    }
  }
  if (current) return { ok: false, error: 'VEVENT sin cerrar' }
  return { ok: true, events: [...byUid.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)) }
}

function eventFrom(props: Property[]): { uid: string; start: Day; end: Day; skip: boolean } | { error: string } {
  const get = (name: string) => props.find((p) => p.name === name)
  const uid = get('UID')?.value.trim()
  if (!uid) return { error: 'Evento sin UID' }
  // Un evento cancelado no bloquea (equivale a que no venga).
  if (get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') return { uid, start: '', end: '', skip: true }

  const startProp = get('DTSTART')
  if (!startProp) return { error: 'Evento sin DTSTART' }
  const start = parseDate(startProp)
  if (!start) return { error: 'Evento con fecha de inicio inválida' }

  const endProp = get('DTEND')
  let endDay: Day
  if (endProp) {
    const end = parseDate(endProp)
    if (!end) return { error: 'Evento con fecha de término inválida' }
    endDay = end.day
  } else {
    endDay = addDays(start.day, 1) // sin DTEND: una noche
  }
  if (endDay < start.day) return { error: 'Evento que termina antes de empezar' }
  // Un evento con hora dentro del mismo día bloquea esa noche (conservador).
  if (endDay === start.day) endDay = addDays(start.day, 1)
  return { uid, start: start.day, end: endDay, skip: false }
}

// ─── Descarga segura ─────────────────────────────────────────────────────
// "airbnb.*" = cualquier dominio de Airbnb (airbnb.cl, airbnb.com, airbnb.co.uk);
// los demás = el dominio y sus subdominios.
export function isAllowedUrl(rawUrl: string, allowedCsv: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return allowedCsv
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern.endsWith('.*')) {
        const base = pattern.slice(0, -2).replace(/[.]/g, '\\.')
        return new RegExp(`^([a-z0-9-]+\\.)*${base}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host)
      }
      return host === pattern || host.endsWith(`.${pattern}`)
    })
}

export type FetchResult = { ok: true; text: string } | { ok: false; error: string }

export async function fetchCalendar(
  rawUrl: string,
  allowedCsv: string,
  options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; fetchImpl?: typeof fetch } = {},
): Promise<FetchResult> {
  const { timeoutMs = 15_000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3, fetchImpl = fetch } = options
  let url = rawUrl
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!isAllowedUrl(url, allowedCsv)) return { ok: false, error: hop === 0 ? 'Dirección no permitida' : 'Redirección a una dirección no permitida' }
      const response = await fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'ReservasUP-iCal/1.0' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return { ok: false, error: `HTTP ${response.status} sin destino` }
        url = new URL(location, url).toString()
        continue
      }
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
      const declared = Number(response.headers.get('content-length') ?? '0')
      if (declared > maxBytes) return { ok: false, error: 'Archivo demasiado grande' }
      const text = await readLimited(response, maxBytes)
      if (text === null) return { ok: false, error: 'Archivo demasiado grande' }
      return { ok: true, text }
    }
    return { ok: false, error: 'Demasiadas redirecciones' }
  } catch (error) {
    return { ok: false, error: (error as Error)?.name === 'AbortError' ? 'Tiempo de espera agotado' : 'Error de red' }
  } finally {
    clearTimeout(timer)
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8').decode(all)
}

// ─── Exportación ─────────────────────────────────────────────────────────
export interface ExportEvent {
  uid: string
  start_date: Day
  end_date: Day
  summary: string
}

const compactDay = (day: Day) => day.replaceAll('-', '')

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Pliega líneas a 75 octetos (RFC 5545 §3.1) sin cortar caracteres UTF-8.
export function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74 // las continuaciones llevan un espacio
    if (encoder.encode(current + ch).length > limit) {
      out.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildCalendar(events: ExportEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reservas UP//Calendario//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDay(e.start_date)}`,
      `DTEND;VALUE=DATE:${compactDay(e.end_date)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
