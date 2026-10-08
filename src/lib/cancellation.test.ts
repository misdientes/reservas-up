import { describe, expect, it } from 'vitest'
import { cancellationInfo, cancellationText } from './cancellation'

describe('fecha límite de cancelación (5 días antes, 100 %)', () => {
  it('llegada el martes 20 de noviembre → gratis hasta el jueves 15', () => {
    const info = cancellationInfo('2026-11-20', '2026-10-08', 5)
    expect(info).toEqual({ refundable: true, freeUntil: '2026-11-15' })
    expect(cancellationText(info, '2026-10-08', 100)).toBe('Cancelación gratuita hasta el domingo 15 de noviembre.')
  })

  it('el mismo día límite todavía es reembolsable; al día siguiente ya no', () => {
    expect(cancellationInfo('2026-11-20', '2026-11-15', 5).refundable).toBe(true)
    expect(cancellationInfo('2026-11-20', '2026-11-16', 5).refundable).toBe(false)
  })

  it('llegada en menos de 5 días → no reembolsable', () => {
    const info = cancellationInfo('2026-10-11', '2026-10-08', 5)
    expect(info.refundable).toBe(false)
    expect(cancellationText(info, '2026-10-08', 100)).toBe('Esta reserva no es reembolsable.')
  })

  it('cruza el cambio de mes y de año (con el año si no es el actual)', () => {
    expect(cancellationInfo('2026-12-03', '2026-10-08', 5).freeUntil).toBe('2026-11-28')
    const info = cancellationInfo('2027-01-03', '2026-10-08', 5)
    expect(info.freeUntil).toBe('2026-12-29')
    expect(cancellationText(cancellationInfo('2027-01-10', '2026-10-08', 5), '2026-10-08', 100)).toBe(
      'Cancelación gratuita hasta el martes 5 de enero de 2027.',
    )
  })

  it('cruza el cambio de horario de septiembre sin correrse un día', () => {
    expect(cancellationInfo('2026-09-08', '2026-08-01', 5).freeUntil).toBe('2026-09-03')
  })

  it('porcentaje distinto de 100 (configurable)', () => {
    expect(cancellationText(cancellationInfo('2026-11-20', '2026-10-08', 5), '2026-10-08', 50)).toBe(
      'Reembolso del 50 % si cancelas hasta el domingo 15 de noviembre.',
    )
  })
})
