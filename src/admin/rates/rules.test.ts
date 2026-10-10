import { describe, expect, it } from 'vitest'
import { dowFromDb, dowToDb, parseClp, validateDiscount, validateRate, validateSeason } from './rules'

const RATE = { name: 'Iquique', base: '40.000', dow: ['', '', '', '', '45.000', '50000', ''], cleaning: '6.000', includedGuests: '2', extraGuest: '15000', minNights: '' }

describe('tarifas: formulario', () => {
  it('lee pesos con o sin puntos', () => {
    expect(parseClp('$40.000')).toBe(40000)
    expect(parseClp('40000')).toBe(40000)
    expect(parseClp('')).toBeNull()
    expect(parseClp('40,5')).toBeNaN()
  })

  it('acepta una tarifa válida', () => {
    expect(validateRate(RATE)).toEqual({})
  })

  it('rechaza precio 0, bajo el mínimo o con decimales; y días inválidos', () => {
    expect(validateRate({ ...RATE, base: '0' })).toHaveProperty('base')
    expect(validateRate({ ...RATE, base: '999' })).toHaveProperty('base')
    expect(validateRate({ ...RATE, base: '40000,5' })).toHaveProperty('base')
    expect(validateRate({ ...RATE, dow: ['', '', '', '', '500', '', ''] })).toHaveProperty('dow4')
    expect(validateRate({ ...RATE, minNights: '61' })).toHaveProperty('minNights')
    expect(validateRate({ ...RATE, includedGuests: '0' })).toHaveProperty('includedGuests')
  })

  it('días: vacío = null; ida y vuelta', () => {
    expect(dowToDb(['', '', '', '', '', '', ''])).toBeNull()
    expect(dowToDb(RATE.dow)).toEqual([null, null, null, null, 45000, 50000, null])
    expect(dowFromDb([null, null, null, null, 45000, 50000, null])).toEqual(['', '', '', '', '45000', '50000', ''])
    expect(dowFromDb(null)).toHaveLength(7)
  })
})

describe('temporadas y descuentos', () => {
  const SEASON = { name: 'Año Nuevo', from: '2026-12-30', to: '2027-01-02', price: '90.000', dow: Array(7).fill(''), minNights: '2', priority: '3' }
  it('valida fechas, precio y prioridad', () => {
    expect(validateSeason(SEASON)).toEqual({})
    expect(validateSeason({ ...SEASON, to: '2026-12-30' })).toHaveProperty('to')
    expect(validateSeason({ ...SEASON, priority: '4' })).toHaveProperty('priority')
    expect(validateSeason({ ...SEASON, price: '' })).toHaveProperty('price')
  })
  it('descuentos: 2 a 365 noches, 1 a 60 %', () => {
    expect(validateDiscount('7', '10')).toEqual({})
    expect(validateDiscount('1', '10')).toHaveProperty('minNights')
    expect(validateDiscount('7', '61')).toHaveProperty('percent')
  })
})
