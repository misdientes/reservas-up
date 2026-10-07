import { describe, expect, it } from 'vitest'
import { nightLines, quoteLines, reasonMessage, type Quote } from './pricing'

const QUOTE: Quote = {
  quotable: true,
  nights: [
    { date: '2026-11-18', kind: 'base', season: null, price_clp: 40000 },
    { date: '2026-11-19', kind: 'base', season: null, price_clp: 40000 },
    { date: '2026-11-20', kind: 'weekend', season: null, price_clp: 45000 },
    { date: '2026-11-21', kind: 'season_weekend', season: 'Verano', price_clp: 60000 },
    { date: '2026-11-22', kind: 'season', season: 'Verano', price_clp: 55000 },
    { date: '2026-11-23', kind: 'season', season: 'Verano', price_clp: 55000 },
  ],
  nights_count: 6,
  cleaning_clp: 6000,
  extra_guests: 2,
  extra_guests_clp: 120000,
  total_clp: 421000,
  min_nights: 2,
}

describe('desglose de precio (sin impuestos en el sitio público)', () => {
  it('agrupa las noches por tipo y precio', () => {
    expect(nightLines(QUOTE.nights!)).toEqual([
      { label: '2 noches × $40.000', amount: '$80.000' },
      { label: '1 noche de fin de semana × $45.000', amount: '$45.000' },
      { label: '1 noche de fin de semana en temporada Verano × $60.000', amount: '$60.000' },
      { label: '2 noches de temporada Verano × $55.000', amount: '$110.000' },
    ])
  })

  it('agrega aseo y huéspedes adicionales', () => {
    const lines = quoteLines(QUOTE)
    expect(lines.at(-2)).toEqual({ label: 'Aseo', amount: '$6.000' })
    expect(lines.at(-1)).toEqual({ label: '2 huéspedes adicionales × 6 noches', amount: '$120.000' })
  })

  it('omite aseo y extras cuando son 0', () => {
    expect(quoteLines({ ...QUOTE, cleaning_clp: 0, extra_guests: 0, extra_guests_clp: 0 })).toHaveLength(4)
    expect(quoteLines({ ...QUOTE, nights: [QUOTE.nights![0]], cleaning_clp: 0, extra_guests: 1, extra_guests_clp: 10000, nights_count: 1 })).toEqual([
      { label: '1 noche × $40.000', amount: '$40.000' },
      { label: '1 huésped adicional × 1 noche', amount: '$10.000' },
    ])
  })

  it('nunca menciona IVA, neto ni impuesto', () => {
    const text = JSON.stringify(quoteLines(QUOTE)).toLowerCase()
    expect(text).not.toMatch(/iva|neto|impuesto/)
  })
})

describe('mensajes por motivo', () => {
  it('explica cada motivo con claridad', () => {
    expect(reasonMessage('min_nights', { minNights: 3 })).toBe('Para estas fechas la estadía mínima es de 3 noches.')
    expect(reasonMessage('min_nights', { minNights: 1 })).toBe('Para estas fechas la estadía mínima es de 1 noche.')
    expect(reasonMessage('advance', { advanceHours: 24 })).toBe('Reserva con al menos 24 horas de anticipación.')
    expect(reasonMessage('max_guests', { maxGuests: 4 })).toBe('Esta propiedad recibe hasta 4 huéspedes.')
    expect(reasonMessage('max_guests', { maxGuests: null })).toBe('Revisa la cantidad de huéspedes.')
    expect(reasonMessage('unavailable', {})).toBe('Esas fechas ya no están disponibles. Elige otras.')
    expect(reasonMessage(undefined, {})).toBe('No pudimos calcular el precio. Inténtalo de nuevo en un momento.')
  })
})
