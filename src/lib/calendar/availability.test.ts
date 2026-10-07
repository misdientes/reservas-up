import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_WINDOW_DAYS,
  availabilityWindow,
  buildStayContext,
  canCheckIn,
  canCheckOut,
  earliestCheckIn,
  isStillAvailable,
  parseStayFromUrl,
  validateStay,
  type OccupiedRange,
  type StayContext,
} from './availability'
import { stayMessage } from '../whatsapp'

// "Ahora": martes 10 de noviembre de 2026, 10:00 en Chile (UTC−3).
const NOW = new Date('2026-11-10T13:00:00Z')

// Ocupado: noches del 20 al 22 (sale el 23) y del 25 al 27 (sale el 28).
const RANGES: OccupiedRange[] = [
  { start: '2026-11-20', end: '2026-11-23' },
  { start: '2026-11-25', end: '2026-11-28' },
]

function ctx(overrides: Partial<StayContext> = {}): StayContext {
  return {
    ...buildStayContext({ now: NOW, minAdvanceHours: 24, checkInTime: '15:00', ranges: RANGES, minNights: 2 }),
    ...overrides,
  }
}

describe('ventana de reserva (igual a get_property_availability)', () => {
  it('son 548 días desde el día consultado', () => {
    expect(AVAILABILITY_WINDOW_DAYS).toBe(548)
    expect(availabilityWindow('2026-11-10')).toEqual({ from: '2026-11-10', to: '2028-05-11' })
  })

  // daterange(p_from, p_from + 548, '[)'): la última noche es p_from + 547.
  it.each([
    ['2027-01-31', '2028-07-31', '2028-08-01'], // desde un mes de 31 días
    ['2028-02-29', '2029-08-29', '2029-08-30'], // desde el 29 de febrero (bisiesto)
    ['2026-12-31', '2028-06-30', '2028-07-01'], // cambio de año
  ])('desde %s: última noche %s; primer día sin información %s', (today, lastNight, windowEnd) => {
    const c: StayContext = { today, earliest: today, windowEnd: availabilityWindow(today).to, ranges: [], minNights: 1 }
    expect(c.windowEnd).toBe(windowEnd)
    expect(canCheckIn(lastNight, c)).toBe(true) // última noche aceptada
    expect(canCheckIn(windowEnd, c)).toBe(false) // primer día rechazado
    expect(canCheckOut(lastNight, windowEnd, c)).toBe(true) // salir el último día sí
    expect(validateStay(lastNight, windowEnd, c)).toBeNull()
    // Salir un día después del fin de la ventana: noche sin información.
    expect(validateStay(lastNight, dayAfter(windowEnd), c)).toBe('window')
  })
})

// Día siguiente calculado aparte (no con addDays, que es lo que se prueba).
function dayAfter(day: string): string {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)).toISOString().slice(0, 10)
}

describe('anticipación mínima y fechas pasadas', () => {
  it('rechaza el pasado y lo que no cumple la anticipación', () => {
    const c = ctx()
    // Hoy 10 a las 10:00 + 24 h = 11 a las 10:00, antes del check-in de las 15:00: el 11 sí.
    expect(c.earliest).toBe('2026-11-11')
    expect(validateStay('2026-11-09', '2026-11-12', c)).toBe('past')
    expect(validateStay('2026-11-10', '2026-11-12', c)).toBe('advance')
    expect(validateStay('2026-11-11', '2026-11-13', c)).toBeNull()
    expect(canCheckIn('2026-11-10', c)).toBe(false)
    expect(canCheckIn('2026-11-11', c)).toBe(true)
  })

  it('en el borde exacto de la hora de check-in', () => {
    // 15:00 en Chile + 24 h = 15:00 del día siguiente: todavía alcanza.
    expect(earliestCheckIn(new Date('2026-11-10T18:00:00Z'), 24, '15:00')).toBe('2026-11-11')
    // Un minuto después ya no: pasa al día subsiguiente.
    expect(earliestCheckIn(new Date('2026-11-10T18:01:00Z'), 24, '15:00')).toBe('2026-11-12')
    // Sin hora de check-in se asume 00:00 (lo más conservador).
    expect(earliestCheckIn(new Date('2026-11-10T13:00:00Z'), 24, null)).toBe('2026-11-12')
    expect(earliestCheckIn(new Date('2026-11-10T13:00:00Z'), 0, '15:00:00')).toBe('2026-11-10')
  })

  it('cerca de la medianoche de Chile', () => {
    // 23:59 del 19 en Chile: hoy es 19 aunque en UTC ya sea 20.
    const late = buildStayContext({ now: new Date('2026-11-20T02:59:00Z'), minAdvanceHours: 0, checkInTime: '00:00', ranges: [], minNights: 1 })
    expect(late.today).toBe('2026-11-19')
    expect(canCheckIn('2026-11-19', late)).toBe(false) // a las 23:59 ya pasó el check-in de las 00:00
    expect(canCheckIn('2026-11-20', late)).toBe(true)
    // 00:00 del 20 en Chile.
    const midnight = buildStayContext({ now: new Date('2026-11-20T03:00:00Z'), minAdvanceHours: 0, checkInTime: '15:00', ranges: [], minNights: 1 })
    expect(midnight.today).toBe('2026-11-20')
    expect(midnight.earliest).toBe('2026-11-20')
  })

  it('con 24 h de anticipación a través del cambio de horario de abril', () => {
    // Sábado 3 de abril de 2027, 14:30 en Chile (UTC−3). 24 h reales después
    // son las 13:30 del domingo 4 (ya en UTC−4): alcanza para el check-in de las 15:00.
    expect(earliestCheckIn(new Date('2027-04-03T17:30:00Z'), 24, '15:00')).toBe('2027-04-04')
    // Sábado 3 a las 16:30: 24 h después son las 15:30 del domingo → lunes 5.
    expect(earliestCheckIn(new Date('2027-04-03T19:30:00Z'), 24, '15:00')).toBe('2027-04-05')
  })

  it('con 24 h de anticipación a través del cambio de horario de septiembre', () => {
    // Sábado 5 de septiembre de 2026, 14:30 en Chile (UTC−4). 24 h reales
    // después son las 15:30 del domingo 6 (ya en UTC−3): pasa al lunes 7.
    expect(earliestCheckIn(new Date('2026-09-05T18:30:00Z'), 24, '15:00')).toBe('2026-09-07')
    // 13:30 del sábado → 14:30 del domingo: alcanza.
    expect(earliestCheckIn(new Date('2026-09-05T17:30:00Z'), 24, '15:00')).toBe('2026-09-06')
  })
})

describe('ocupaciones con estadía [llegada, salida)', () => {
  it('permite llegar el mismo día en que termina otra ocupación', () => {
    const c = ctx()
    expect(canCheckIn('2026-11-23', c)).toBe(true)
    expect(validateStay('2026-11-23', '2026-11-25', c)).toBeNull()
  })

  it('permite salir el día en que empieza otra ocupación', () => {
    const c = ctx()
    expect(canCheckOut('2026-11-18', '2026-11-20', c)).toBe(true)
    expect(validateStay('2026-11-18', '2026-11-20', c)).toBeNull()
    // Pero no se puede llegar ese día: su noche está ocupada.
    expect(canCheckIn('2026-11-20', c)).toBe(false)
    expect(validateStay('2026-11-20', '2026-11-24', c)).toBe('occupied')
  })

  it('rechaza una selección que cruza un rango ocupado', () => {
    const c = ctx()
    expect(canCheckOut('2026-11-18', '2026-11-21', c)).toBe(false)
    expect(validateStay('2026-11-18', '2026-11-24', c)).toBe('crosses')
    expect(validateStay('2026-11-23', '2026-11-26', c)).toBe('crosses')
  })

  it('exige el mínimo de noches de la propiedad', () => {
    const c = ctx({ minNights: 2 })
    expect(validateStay('2026-11-12', '2026-11-13', c)).toBe('minNights')
    expect(validateStay('2026-11-12', '2026-11-14', c)).toBeNull()
    expect(validateStay('2026-11-14', '2026-11-12', c)).toBe('order')
  })
})

describe('disponibilidad fresca antes de contactar', () => {
  it('detecta que las fechas elegidas se acaban de ocupar', () => {
    const c = ctx()
    expect(isStillAvailable('2026-11-14', '2026-11-17', RANGES, c)).toBe(true)
    const fresh = [...RANGES, { start: '2026-11-16', end: '2026-11-18' }]
    expect(isStillAvailable('2026-11-14', '2026-11-17', fresh, c)).toBe(false)
    expect(isStillAvailable('2026-11-16', '2026-11-18', fresh, c)).toBe(false)
    // Una ocupación nueva que empieza el día de salida no la afecta.
    expect(isStillAvailable('2026-11-14', '2026-11-16', fresh, c)).toBe(true)
  })
})

describe('parámetros de la URL', () => {
  const parse = (query: string, maxGuests = 4) => parseStayFromUrl(new URLSearchParams(query), ctx(), maxGuests)

  it('acepta fechas y huéspedes válidos', () => {
    expect(parse('llegada=2026-11-12&salida=2026-11-15&huespedes=2')).toEqual({
      llegada: '2026-11-12',
      salida: '2026-11-15',
      huespedes: 2,
      notices: [],
    })
  })

  it.each([
    ['llegada=2026-13-01&salida=2026-13-04', 'invalidDates'],
    ['llegada=2026-02-30&salida=2026-03-02', 'invalidDates'],
    ['llegada=abc&salida=2026-11-15', 'invalidDates'],
    ['llegada=2026-11-12', 'invalidDates'], // falta la salida
    ['llegada=2026-11-15&salida=2026-11-12', 'invalidDates'], // invertidas
    ['llegada=2026-11-12&salida=2026-11-13', 'invalidDates'], // menos del mínimo
    ['llegada=2026-11-20&salida=2026-11-23', 'unavailableDates'], // ocupadas
    ['llegada=2026-11-18&salida=2026-11-24', 'unavailableDates'], // cruzan una ocupación
    ['llegada=2026-11-01&salida=2026-11-04', 'unavailableDates'], // pasadas
    ['llegada=2026-11-10&salida=2026-11-12', 'unavailableDates'], // sin anticipación
  ])('descarta %s con aviso %s', (query, notice) => {
    const result = parse(query)
    expect(result.llegada).toBeNull()
    expect(result.salida).toBeNull()
    expect(result.notices).toEqual([notice])
  })

  it.each(['0', '-1', '2.5', 'dos', '5', '99'])('descarta huespedes=%s (máximo 4)', (value) => {
    const result = parse(`huespedes=${value}`)
    expect(result.huespedes).toBeNull()
    expect(result.notices).toEqual(['invalidGuests'])
  })
})

describe('mensaje de WhatsApp', () => {
  it('incluye nombre, fechas en español y huéspedes', () => {
    expect(stayMessage({ propertyName: 'Iquique 1', llegada: '2026-11-20', salida: '2026-11-23', huespedes: 2 })).toBe(
      'Me interesa Iquique 1, del 20 al 23 de noviembre, para 2 huéspedes.',
    )
    expect(stayMessage({ propertyName: 'Iquique 1', llegada: '2026-11-30', salida: '2026-12-02', huespedes: 1 })).toBe(
      'Me interesa Iquique 1, del 30 de noviembre al 2 de diciembre, para 1 huésped.',
    )
    expect(stayMessage({ propertyName: 'Santiago 1', llegada: '2026-12-30', salida: '2027-01-02', huespedes: null })).toBe(
      'Me interesa Santiago 1, del 30 de diciembre de 2026 al 2 de enero de 2027.',
    )
  })

  it('sin fechas es un mensaje genérico con el nombre', () => {
    expect(stayMessage({ propertyName: 'Iquique 1', llegada: null, salida: null, huespedes: null })).toBe('Me interesa Iquique 1.')
  })
})
