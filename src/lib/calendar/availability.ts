import { addDays, compareDays, diffDays, isValidDay, zonedNow, type Day } from '../dates/day'

// Reglas del calendario público (CLAUDE.md §4). Lógica pura, sin interfaz:
// se prueba en availability.test.ts. El servidor vuelve a validar todo al
// crear la reserva (Sesión 9); esto evita ofrecer fechas imposibles.

// MISMA ventana que get_property_availability (migración 20261007160003):
// daterange(p_from, p_from + 548, '[)'). Son 548 DÍAS (no meses) contados
// desde el día consultado. Fuera de esa ventana no se sabe si hay ocupación,
// así que esos días se muestran como no disponibles.
export const AVAILABILITY_WINDOW_DAYS = 548

// Rango ocupado [start, end): el día end queda libre (puede ser una llegada).
export interface OccupiedRange {
  start: Day
  end: Day
}

export interface StayContext {
  today: Day
  earliest: Day // primera llegada posible según la anticipación mínima
  windowEnd: Day // primer día SIN información (exclusivo): today + 548
  ranges: OccupiedRange[]
  minNights: number
}

export type StayError = 'order' | 'past' | 'advance' | 'window' | 'occupied' | 'crosses' | 'minNights'

export function availabilityWindow(today: Day): { from: Day; to: Day } {
  return { from: today, to: addDays(today, AVAILABILITY_WINDOW_DAYS) }
}

// "HH:MM" o "HH:MM:SS" → minutos desde medianoche.
function timeToMinutes(time: string | null): number {
  if (!time) return 0
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}

// Primera llegada posible: ahora + anticipación (instante real, así el
// cambio de horario no la mueve), llevado a la fecha y hora de Chile. Si a
// esa hora ya pasó el check-in de ese día, la llegada más temprana es el
// día siguiente. Sin hora de check-in se asume 00:00 (lo más conservador).
export function earliestCheckIn(now: Date, minAdvanceHours: number, checkInTime: string | null): Day {
  const limit = zonedNow(new Date(now.getTime() + minAdvanceHours * 3_600_000))
  return limit.minutes <= timeToMinutes(checkInTime) ? limit.day : addDays(limit.day, 1)
}

export function buildStayContext(input: {
  now: Date
  minAdvanceHours: number
  checkInTime: string | null
  ranges: OccupiedRange[]
  minNights: number
}): StayContext {
  const today = zonedNow(input.now).day
  return {
    today,
    earliest: earliestCheckIn(input.now, input.minAdvanceHours, input.checkInTime),
    windowEnd: availabilityWindow(today).to,
    ranges: input.ranges,
    minNights: Math.max(1, input.minNights),
  }
}

// Noche ocupada por una ocupación (sin contar pasado ni ventana).
export function isNightOccupied(day: Day, ranges: OccupiedRange[]): boolean {
  return ranges.some((r) => compareDays(day, r.start) >= 0 && compareDays(day, r.end) < 0)
}

// Noche que no se puede vender: pasada, fuera de la ventana u ocupada.
export function isNightBlocked(day: Day, ctx: StayContext): boolean {
  return compareDays(day, ctx.today) < 0 || compareDays(day, ctx.windowEnd) >= 0 || isNightOccupied(day, ctx.ranges)
}

export function canCheckIn(day: Day, ctx: StayContext): boolean {
  return compareDays(day, ctx.earliest) >= 0 && !isNightBlocked(day, ctx)
}

// La salida puede ser el primer día de una ocupación: lo que importa es que
// todas las noches de [llegada, salida) estén libres.
export function canCheckOut(checkIn: Day, day: Day, ctx: StayContext): boolean {
  if (compareDays(day, checkIn) <= 0 || compareDays(day, ctx.windowEnd) > 0) return false
  for (let night = checkIn; compareDays(night, day) < 0; night = addDays(night, 1)) {
    if (isNightBlocked(night, ctx)) return false
  }
  return true
}

export function validateStay(checkIn: Day, checkOut: Day, ctx: StayContext): StayError | null {
  if (compareDays(checkOut, checkIn) <= 0) return 'order'
  if (compareDays(checkIn, ctx.today) < 0) return 'past'
  if (compareDays(checkIn, ctx.earliest) < 0) return 'advance'
  if (compareDays(checkIn, ctx.windowEnd) >= 0 || compareDays(checkOut, ctx.windowEnd) > 0) return 'window'
  if (isNightOccupied(checkIn, ctx.ranges)) return 'occupied'
  if (!canCheckOut(checkIn, checkOut, ctx)) return 'crosses'
  if (diffDays(checkIn, checkOut) < ctx.minNights) return 'minNights'
  return null
}

// Antes de contactar o reservar: ¿las fechas siguen libres con la
// disponibilidad recién consultada?
export function isStillAvailable(checkIn: Day, checkOut: Day, freshRanges: OccupiedRange[], ctx: StayContext): boolean {
  const error = validateStay(checkIn, checkOut, { ...ctx, ranges: freshRanges })
  return error !== 'occupied' && error !== 'crosses'
}

export type UrlNotice = 'invalidDates' | 'unavailableDates' | 'invalidGuests'

export interface ParsedStay {
  llegada: Day | null
  salida: Day | null
  huespedes: number | null
  notices: UrlNotice[]
}

// Fechas y huéspedes que vienen en la URL: lo inválido se descarta con aviso.
export function parseStayFromUrl(params: URLSearchParams, ctx: StayContext, maxGuests: number): ParsedStay {
  const notices: UrlNotice[] = []
  const rawIn = params.get('llegada')
  const rawOut = params.get('salida')
  let llegada: Day | null = null
  let salida: Day | null = null

  if (rawIn || rawOut) {
    if (!isValidDay(rawIn) || !isValidDay(rawOut)) {
      notices.push('invalidDates')
    } else {
      const error = validateStay(rawIn, rawOut, ctx)
      if (error === null) {
        llegada = rawIn
        salida = rawOut
      } else {
        notices.push(error === 'order' || error === 'minNights' ? 'invalidDates' : 'unavailableDates')
      }
    }
  }

  const rawGuests = params.get('huespedes')
  let huespedes: number | null = null
  if (rawGuests !== null) {
    const n = Number(rawGuests)
    if (Number.isInteger(n) && n >= 1 && n <= maxGuests) huespedes = n
    else notices.push('invalidGuests')
  }

  return { llegada, salida, huespedes, notices }
}
