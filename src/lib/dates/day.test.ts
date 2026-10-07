import { afterEach, describe, expect, it } from 'vitest'
import {
  addDays,
  diffDays,
  formatLong,
  formatRange,
  formatRangeShort,
  isValidDay,
  isoWeekday,
  monthGrid,
  zonedNow,
} from './day'

// Las fechas de estadía no deben depender de la zona horaria del equipo.
const ORIGINAL_TZ = process.env.TZ
const ZONES = ['UTC', 'America/Santiago', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('fechas "solo día"', () => {
  it('valida el formato y rechaza fechas imposibles', () => {
    expect(isValidDay('2026-11-20')).toBe(true)
    expect(isValidDay('2028-02-29')).toBe(true) // bisiesto
    expect(isValidDay('2027-02-29')).toBe(false)
    expect(isValidDay('2026-02-30')).toBe(false)
    expect(isValidDay('2026-13-01')).toBe(false)
    expect(isValidDay('2026-1-5')).toBe(false)
    expect(isValidDay('abc')).toBe(false)
    expect(isValidDay(null)).toBe(false)
  })

  it.each(ZONES)('suma días cruzando los cambios de horario de Chile sin correrse (TZ=%s)', (zone) => {
    process.env.TZ = zone
    // Septiembre: Chile adelanta la hora el domingo 6 de septiembre de 2026.
    expect(addDays('2026-09-05', 1)).toBe('2026-09-06')
    expect(addDays('2026-09-05', 2)).toBe('2026-09-07')
    // Abril: Chile atrasa la hora el domingo 4 de abril de 2027.
    expect(addDays('2027-04-03', 1)).toBe('2027-04-04')
    expect(addDays('2027-04-04', 1)).toBe('2027-04-05')
    expect(diffDays('2027-04-01', '2027-04-08')).toBe(7)
    expect(diffDays('2026-09-01', '2026-09-30')).toBe(29)
    // Fin de mes, año y bisiesto.
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(isoWeekday('2026-11-20')).toBe(5) // viernes
    expect(isoWeekday('2027-04-04')).toBe(7) // domingo
  })
})

describe('"ahora" en Chile cerca de la medianoche y de los cambios de horario', () => {
  it.each(ZONES)('traduce instantes a la fecha y hora de Chile (TZ del equipo=%s)', (zone) => {
    process.env.TZ = zone
    // Horario de verano (UTC−3): medianoche del 20 de noviembre.
    expect(zonedNow(new Date('2026-11-20T02:59:00Z'))).toEqual({ day: '2026-11-19', minutes: 23 * 60 + 59 })
    expect(zonedNow(new Date('2026-11-20T03:00:00Z'))).toEqual({ day: '2026-11-20', minutes: 0 })
    // Abril 2027: a las 03:00 UTC el reloj vuelve de 00:00 a 23:00 del sábado 3.
    expect(zonedNow(new Date('2027-04-04T02:59:00Z')).day).toBe('2027-04-03')
    expect(zonedNow(new Date('2027-04-04T03:00:00Z'))).toEqual({ day: '2027-04-03', minutes: 23 * 60 })
    expect(zonedNow(new Date('2027-04-04T03:59:00Z')).day).toBe('2027-04-03')
    expect(zonedNow(new Date('2027-04-04T04:00:00Z'))).toEqual({ day: '2027-04-04', minutes: 0 })
    // Septiembre 2026: a las 04:00 UTC el reloj salta de 00:00 a 01:00 del domingo 6.
    expect(zonedNow(new Date('2026-09-06T03:59:00Z'))).toEqual({ day: '2026-09-05', minutes: 23 * 60 + 59 })
    expect(zonedNow(new Date('2026-09-06T04:00:00Z'))).toEqual({ day: '2026-09-06', minutes: 60 })
  })
})

describe('grilla del mes', () => {
  it('empieza en lunes y deja celdas vacías fuera del mes', () => {
    const weeks = monthGrid('2026-11-01') // 1 de noviembre de 2026 es domingo
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(weeks.flat().filter(Boolean)).toHaveLength(30)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })
})

describe('formato en español', () => {
  it('escribe fechas y rangos legibles', () => {
    expect(formatLong('2026-11-20')).toBe('viernes 20 de noviembre de 2026')
    expect(formatRange('2026-11-20', '2026-11-23')).toBe('del 20 al 23 de noviembre')
    expect(formatRange('2026-11-30', '2026-12-02')).toBe('del 30 de noviembre al 2 de diciembre')
    expect(formatRange('2026-12-30', '2027-01-02')).toBe('del 30 de diciembre de 2026 al 2 de enero de 2027')
    expect(formatRangeShort('2026-11-20', '2026-11-23')).toBe('20–23 nov')
    expect(formatRangeShort('2026-11-30', '2026-12-02')).toBe('30 nov – 2 dic')
  })
})
