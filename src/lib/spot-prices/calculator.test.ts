import { describe, expect, it } from 'vitest'
import { CALC_ROWS, calcValue, parseAmount } from './calculator'

const SPOT = 3537.9

describe('calcValue', () => {
  it('1 oz t at 100% matches a counter karat table', () => {
    const row = (k: string) => CALC_ROWS.gold.find((r) => r.key === k)!.fineness
    expect(calcValue(1, 'ozt', SPOT, row('k14'), 100)).toBe(2063.78)
    expect(calcValue(1, 'ozt', SPOT, row('k18'), 100)).toBe(2653.43)
    expect(calcValue(1, 'ozt', SPOT, row('coin900'), 100)).toBe(3184.11)
  })
  it('converts grams and pennyweight through troy ounces', () => {
    // 31.1034768 g = 20 dwt = 1 oz t
    expect(calcValue(31.1034768, 'g', SPOT, 1, 100)).toBe(3537.9)
    expect(calcValue(20, 'dwt', SPOT, 1, 100)).toBe(3537.9)
  })
  it('applies the percent of market value', () => {
    expect(calcValue(1, 'ozt', 1000, 1, 90)).toBe(900)
    expect(calcValue(1, 'ozt', 1000, 1, 0)).toBe(0)
  })
  it('is null when weight, spot or percent is missing', () => {
    expect(calcValue(null, 'ozt', SPOT, 1, 100)).toBeNull()
    expect(calcValue(1, 'ozt', null, 1, 100)).toBeNull()
    expect(calcValue(1, 'ozt', SPOT, 1, null)).toBeNull()
  })
})

describe('parseAmount', () => {
  it('accepts zero and decimals, refuses blank, junk and negatives', () => {
    expect(parseAmount('2.5')).toBe(2.5)
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('-1')).toBeNull()
  })
})
