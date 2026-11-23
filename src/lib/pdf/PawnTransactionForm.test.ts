import { describe, expect, it } from 'vitest'
import { code39Widths } from './PawnTransactionForm'

describe('code39Widths (the ticket barcode)', () => {
  it('wraps the text in start and stop characters and separates characters with a narrow gap', () => {
    const parts = code39Widths('1')!
    // *1* = 3 characters x 9 elements + 2 gaps between them
    expect(parts).toHaveLength(3 * 9 + 2)
    // every character starts and ends on a bar
    expect(parts[0].bar).toBe(true)
    expect(parts[8].bar).toBe(true)
    expect(parts[9]).toEqual({ bar: false, w: 1 })
    expect(parts[10].bar).toBe(true)
  })

  it('gives every character exactly three wide elements', () => {
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-') {
      const parts = code39Widths(ch)!
      const own = parts.slice(10, 19) // the character between the two asterisks
      expect(own.filter((p) => p.w > 1)).toHaveLength(3)
    }
  })

  it('draws the digit 1 as wide-bar, narrow, narrow, wide-space ... wide-bar', () => {
    const own = code39Widths('1')!.slice(10, 19).map((p) => (p.w > 1 ? 'W' : 'n'))
    expect(own.join('')).toBe('WnnWnnnnW')
  })

  it('encodes old ticket numbers and new PT- numbers, upper-casing letters', () => {
    expect(code39Widths('15645')).not.toBeNull()
    expect(code39Widths('PT-015665')).not.toBeNull()
    expect(code39Widths('pt-015665')).toEqual(code39Widths('PT-015665'))
  })

  it('draws no barcode for a number it cannot encode', () => {
    expect(code39Widths('15645/2')).toBeNull()
  })
})
