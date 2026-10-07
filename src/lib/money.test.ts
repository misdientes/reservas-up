import { describe, expect, it } from 'vitest'
import { formatCLP } from './money'

describe('pesos chilenos', () => {
  it.each([
    [0, '$0'],
    [7, '$7'],
    [999, '$999'],
    [1000, '$1.000'],
    [40000, '$40.000'],
    [126000, '$126.000'],
    [1000000, '$1.000.000'],
    [12345678, '$12.345.678'],
    [-6000, '-$6.000'],
    [39999.6, '$40.000'], // nunca decimales
  ])('%s → %s', (amount, text) => {
    expect(formatCLP(amount)).toBe(text)
  })
})
