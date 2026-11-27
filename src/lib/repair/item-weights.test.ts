import { describe, expect, it } from 'vitest'
import { allReceived, cleanKarat, fmtGramsChange, gramsChange, parseGrams, sameKarat } from './item-weights'

describe('item weights', () => {
  it('reads grams: positive, up to 4 decimals, comma ok', () => {
    expect(parseGrams('3.25')).toBe(3.25)
    expect(parseGrams(' 40,6 ')).toBe(40.6)
    expect(parseGrams('0')).toBeNull()
    expect(parseGrams('-1')).toBeNull()
    expect(parseGrams('1.23456')).toBeNull()
    expect(parseGrams('abc')).toBeNull()
    expect(parseGrams('')).toBeNull()
  })

  it('compares karat marks loosely', () => {
    expect(sameKarat('14k', '14K')).toBe(true)
    expect(sameKarat('14 kt', '14k')).toBe(true)
    expect(sameKarat('10k', '14k')).toBe(false)
    expect(sameKarat('925', '925')).toBe(true)
    expect(sameKarat(null, '')).toBe(true)
    expect(cleanKarat('  14k  ')).toBe('14k')
    expect(cleanKarat('')).toBeNull()
  })

  it('shows a change of 0.01 g or more, signed', () => {
    expect(gramsChange(40.6, 40.85)).toBe(0.25)
    expect(gramsChange(3.1, 3.104)).toBeNull()
    expect(gramsChange(null, 3)).toBeNull()
    expect(fmtGramsChange(0.25)).toBe('+0.25 g')
    expect(fmtGramsChange(-0.3)).toBe('−0.30 g')
  })

  it('every item must be weighed in', () => {
    expect(allReceived([])).toBe(true)
    expect(allReceived([{ received_at: 'x', final_weighed_at: null }])).toBe(true)
    expect(allReceived([{ received_at: 'x', final_weighed_at: null }, { received_at: null, final_weighed_at: null }])).toBe(false)
  })
})
