import { describe, expect, it } from 'vitest'
import {
  formatReadyBy,
  localDatePlusDays,
  metalLabel,
  parseLocalDate,
  sanitizeDecimal,
  simpleItemHeading,
  sizeFieldFor,
} from './simple-intake'

describe('localDatePlusDays', () => {
  it('uses the local calendar and crosses month / year ends', () => {
    const base = new Date(2026, 10, 10, 21, 30) // Nov 10, 9:30 PM local
    expect(localDatePlusDays(base, 0)).toBe('2026-11-10')
    expect(localDatePlusDays(base, 1)).toBe('2026-11-11')
    expect(localDatePlusDays(base, 3)).toBe('2026-11-13')
    expect(localDatePlusDays(base, 7)).toBe('2026-11-17')
    expect(localDatePlusDays(new Date(2026, 11, 30), 3)).toBe('2027-01-02')
  })
})

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight and rejects junk', () => {
    const d = parseLocalDate('2026-11-13')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(10)
    expect(d?.getDate()).toBe(13)
    expect(d?.getHours()).toBe(0)
    expect(parseLocalDate('')).toBeNull()
    expect(parseLocalDate('13/11/2026')).toBeNull()
  })
})

describe('formatReadyBy', () => {
  it('renders long and short forms in the UI language', () => {
    expect(formatReadyBy('2026-11-13', 'en-US', 'long')).toBe('Friday, Nov 13')
    expect(formatReadyBy('2026-11-13', 'en-US', 'short')).toBe('Nov 13')
    expect(formatReadyBy('2026-11-13', 'es-US', 'long')).toMatch(/viernes/i)
    expect(formatReadyBy('nope', 'en-US', 'long')).toBe('')
  })
})

describe('metalLabel', () => {
  const words = { silver: 'Silver', platinum: 'Platinum' }
  it('labels fineness values, leaves karats alone', () => {
    expect(metalLabel('925', words)).toBe('Silver 925')
    expect(metalLabel('950', words)).toBe('Platinum 950')
    expect(metalLabel('14k', words)).toBe('14k')
  })
})

describe('sizeFieldFor', () => {
  it('ring size for rings, length for things on a chain, hidden otherwise', () => {
    expect(sizeFieldFor('ring')).toBe('ring')
    expect(sizeFieldFor('chain')).toBe('length')
    expect(sizeFieldFor('necklace')).toBe('length')
    expect(sizeFieldFor('bracelet')).toBe('length')
    expect(sizeFieldFor('nameplate')).toBe('length')
    expect(sizeFieldFor('watch')).toBeNull()
    expect(sizeFieldFor('earrings')).toBeNull()
    expect(sizeFieldFor('')).toBeNull()
  })
})

describe('sanitizeDecimal', () => {
  it('keeps digits and one decimal point', () => {
    expect(sanitizeDecimal('12.5')).toBe('12.5')
    expect(sanitizeDecimal('1a2b.3.4')).toBe('12.34')
    expect(sanitizeDecimal('3,5')).toBe('3.5')
    expect(sanitizeDecimal('-7')).toBe('7')
    expect(sanitizeDecimal('')).toBe('')
  })
})

describe('simpleItemHeading', () => {
  it('builds "14k Ring · Sizing" and degrades gracefully', () => {
    expect(
      simpleItemHeading({ metal: '14k', typeLabel: 'Ring', serviceLabel: 'Sizing' }),
    ).toBe('14k Ring · Sizing')
    expect(
      simpleItemHeading({ metal: '', typeLabel: 'Watch', serviceLabel: '' }),
    ).toBe('Watch')
    expect(
      simpleItemHeading({ metal: '', typeLabel: '', serviceLabel: 'Repair' }),
    ).toBe('Repair')
    expect(simpleItemHeading({ metal: '', typeLabel: '', serviceLabel: '' })).toBe('')
  })
})
