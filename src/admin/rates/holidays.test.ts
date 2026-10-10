import { describe, expect, it } from 'vitest'
import { chileHolidays, easterSunday, juneSolsticeChile, suggestSeasons } from './holidays'

describe('feriados de Chile', () => {
  it('2026 coincide con la lista publicada', () => {
    expect(chileHolidays(2026).map((h) => h.day)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29',
      '2026-07-16', '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01',
      '2026-12-08', '2026-12-25',
    ])
  })

  it('2027: traslados al lunes (San Pedro 28 jun, Dos Mundos 11 oct)', () => {
    const days = chileHolidays(2027).map((h) => h.day)
    expect(days).toContain('2027-06-28')
    expect(days).toContain('2027-10-11')
    expect(days).toContain('2027-03-26') // Viernes Santo
    expect(days).toContain('2027-06-21') // solsticio
    expect(days).not.toContain('2027-06-29')
  })

  it('Pascua y solsticio', () => {
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(juneSolsticeChile(2025)).toBe('2025-06-20')
    expect(juneSolsticeChile(2026)).toBe('2026-06-21')
  })

  it('31 de octubre: martes → viernes anterior; miércoles → viernes siguiente', () => {
    expect(chileHolidays(2028).map((h) => h.day)).toContain('2028-10-27') // 31 oct 2028 es martes
    expect(chileHolidays(2029).map((h) => h.day)).toContain('2029-11-02') // 31 oct 2029 es miércoles
  })

  it('17 de septiembre cuando cae lunes (2029) y 20 cuando cae viernes (2024)', () => {
    expect(chileHolidays(2029).map((h) => h.day)).toContain('2029-09-17')
    expect(chileHolidays(2024).map((h) => h.day)).toContain('2024-09-20')
  })
})

describe('temporadas sugeridas', () => {
  const s = suggestSeasons([2026, 2027], '2026-10-10')

  it('Fiestas Patrias pasadas no se sugieren; Navidad 2026 sí, de jueves a domingo', () => {
    expect(s.find((x) => x.name.includes('Fiestas Patrias') && x.from.startsWith('2026'))).toBeUndefined()
    expect(s.find((x) => x.name === 'Navidad' && x.from.startsWith('2026'))).toMatchObject({ from: '2026-12-24', to: '2026-12-27' })
  })

  it('fin de semana largo: llega la víspera y sale el último día libre', () => {
    // Dos Mundos 2026 (lunes 12 oct): noches del viernes 9 al domingo 11.
    expect(suggestSeasons([2026], '2026-10-01').find((x) => x.name === 'Encuentro de Dos Mundos')).toMatchObject({ from: '2026-10-09', to: '2026-10-12' })
  })

  it('omite feriados que caen en un fin de semana normal', () => {
    expect(s.find((x) => x.name.startsWith('Todos los Santos') && x.from.startsWith('2026'))).toBeUndefined()
  })

  it('Año Nuevo 2027 (viernes): noches del 31 de diciembre al 2 de enero', () => {
    expect(s.find((x) => x.name === 'Año Nuevo' && x.to.startsWith('2027'))).toMatchObject({ from: '2026-12-31', to: '2027-01-03' })
  })
})
