import { describe, expect, it } from 'vitest'
import { byTaxLevel, taxBreakdown, taxRateInputSchema, totalTaxRate } from './sales-tax'

const state = { name: 'Florida', level: 'state' as const, rate: 0.06, is_active: true }
const county = { name: 'Hillsborough County', level: 'county' as const, rate: 0.015, is_active: true }
const city = { name: 'City', level: 'city' as const, rate: 0.0025, is_active: false }

describe('totalTaxRate', () => {
  it('adds the active rates without float drift', () => {
    expect(totalTaxRate([state, county])).toBe(0.075)
    expect(totalTaxRate([state, county, { ...city, is_active: true }])).toBe(0.0775)
  })
  it('leaves out rates that are switched off', () => {
    expect(totalTaxRate([state, county, city])).toBe(0.075)
  })
  it('is zero with no rates', () => {
    expect(totalTaxRate([])).toBe(0)
  })
})

describe('byTaxLevel', () => {
  it('lists state, then county, then city', () => {
    expect(byTaxLevel([city, county, state]).map((r) => r.level)).toEqual(['state', 'county', 'city'])
  })
})

describe('taxBreakdown', () => {
  it('names each active rate', () => {
    expect(taxBreakdown([state, county, city])).toBe('Florida 6% + Hillsborough County 1.5%')
  })
})

describe('taxRateInputSchema', () => {
  const input = { name: ' Florida ', level: 'state', percent: '6', is_active: true }
  it('stores a typed percent as a fraction', () => {
    expect(taxRateInputSchema.parse(input)).toEqual({ name: 'Florida', level: 'state', percent: 0.06, is_active: true })
    expect(taxRateInputSchema.parse({ ...input, percent: '1.5' }).percent).toBe(0.015)
    expect(taxRateInputSchema.parse({ ...input, percent: '6.25' }).percent).toBe(0.0625)
  })
  it('refuses a rate finer than two decimals instead of rounding it', () => {
    const r = taxRateInputSchema.safeParse({ ...input, percent: '8.875' })
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0].message).toBe('precision')
  })
  it('refuses zero, negative, over 100 and an unknown level', () => {
    for (const percent of ['0', '-1', '101', '']) {
      expect(taxRateInputSchema.safeParse({ ...input, percent }).success).toBe(false)
    }
    expect(taxRateInputSchema.safeParse({ ...input, level: 'planet' }).success).toBe(false)
  })
})
