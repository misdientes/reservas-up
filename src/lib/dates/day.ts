// Fechas "solo día" (YYYY-MM-DD) para estadías.
//
// Una fecha de estadía es un día del calendario de Chile, no un instante:
// nunca se convierte a Date con hora local, porque según la zona del equipo
// (o el cambio de horario de abril y septiembre) podría correrse un día.
// La aritmética usa Date.UTC solo como contador de días (UTC no tiene
// cambios de horario), y el "ahora" se traduce a Chile con Intl.

export type Day = string // 'YYYY-MM-DD'

export const CHILE_TZ = 'America/Santiago'
const MS_PER_DAY = 86_400_000
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function toUtcMs(day: Day): number {
  const [, y, m, d] = DAY_PATTERN.exec(day)!
  return Date.UTC(Number(y), Number(m) - 1, Number(d))
}

function fromUtcMs(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isValidDay(value: unknown): value is Day {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false
  // Rechaza fechas imposibles como 2026-02-30 (no "dan la vuelta").
  return fromUtcMs(toUtcMs(value)) === value
}

export function makeDay(year: number, month: number, day: number): Day {
  return fromUtcMs(Date.UTC(year, month - 1, day))
}

export function parts(day: Day): { year: number; month: number; day: number } {
  const [, y, m, d] = DAY_PATTERN.exec(day)!
  return { year: Number(y), month: Number(m), day: Number(d) }
}

export function addDays(day: Day, n: number): Day {
  return fromUtcMs(toUtcMs(day) + n * MS_PER_DAY)
}

export function diffDays(from: Day, to: Day): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY)
}

// Las cadenas YYYY-MM-DD se ordenan igual que las fechas.
export function compareDays(a: Day, b: Day): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Día de la semana ISO: 1 = lunes … 7 = domingo.
export function isoWeekday(day: Day): number {
  const weekday = new Date(toUtcMs(day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

export function startOfMonth(day: Day): Day {
  const { year, month } = parts(day)
  return makeDay(year, month, 1)
}

export function addMonths(day: Day, n: number): Day {
  const { year, month } = parts(day)
  return makeDay(year, month + n, 1)
}

export function daysInMonth(day: Day): number {
  const { year, month } = parts(day)
  return parts(makeDay(year, month + 1, 0)).day
}

// Semanas del mes (lunes a domingo); null = celda fuera del mes.
export function monthGrid(monthStart: Day): (Day | null)[][] {
  const first = startOfMonth(monthStart)
  const offset = isoWeekday(first) - 1
  const total = daysInMonth(first)
  const cells: (Day | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => addDays(first, i)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (Day | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// Fecha y hora de pared en Chile para un instante (DST incluido).
export function zonedNow(instant: Date, timeZone = CHILE_TZ): { day: Day; minutes: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: string) => formatted.find((p) => p.type === type)!.value
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

// ─── Formato en español (sin depender de Intl para no variar por navegador) ─
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const WEEKDAYS_SHORT = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']

export function monthName(day: Day): string {
  return MONTHS[parts(day).month - 1]
}

export function weekdayName(day: Day): string {
  return WEEKDAYS[isoWeekday(day) - 1]
}

// "jueves 20 de noviembre de 2026"
export function formatLong(day: Day): string {
  const { year, month, day: d } = parts(day)
  return `${weekdayName(day)} ${d} de ${MONTHS[month - 1]} de ${year}`
}

// "noviembre de 2026"
export function formatMonthYear(day: Day): string {
  const { year, month } = parts(day)
  return `${MONTHS[month - 1]} de ${year}`
}

// "del 20 al 23 de noviembre" · "del 30 de noviembre al 2 de diciembre"
// · "del 30 de diciembre de 2026 al 2 de enero de 2027"
export function formatRange(from: Day, to: Day): string {
  const a = parts(from)
  const b = parts(to)
  if (a.year !== b.year) {
    return `del ${a.day} de ${MONTHS[a.month - 1]} de ${a.year} al ${b.day} de ${MONTHS[b.month - 1]} de ${b.year}`
  }
  if (a.month !== b.month) {
    return `del ${a.day} de ${MONTHS[a.month - 1]} al ${b.day} de ${MONTHS[b.month - 1]}`
  }
  return `del ${a.day} al ${b.day} de ${MONTHS[a.month - 1]}`
}

// "20–23 nov" · "30 nov – 2 dic" (resumen compacto de la barra de reserva)
export function formatRangeShort(from: Day, to: Day): string {
  const a = parts(from)
  const b = parts(to)
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${MONTHS_SHORT[a.month - 1]}`
  return `${a.day} ${MONTHS_SHORT[a.month - 1]} – ${b.day} ${MONTHS_SHORT[b.month - 1]}`
}

// "24 dic 2026" (listas del panel)
export function formatDayShort(day: Day): string {
  const { year, month, day: d } = parts(day)
  return `${d} ${MONTHS_SHORT[month - 1]} ${year}`
}
