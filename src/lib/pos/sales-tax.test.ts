import { describe, expect, it } from 'vitest'
import { computeTotal } from './cart'
import {
  allocateDiscount,
  byTaxLevel,
  computeCartTotals,
  quoteSaleTax,
  taxBreakdown,
  taxModeFor,
  taxRateInputSchema,
  totalTaxRate,
  type ShopTax,
  type TaxRate,
} from './sales-tax'

const state: TaxRate = { id: 's', name: 'State', level: 'state', rate: 0.06, item_cap: null, is_active: true }
const county: TaxRate = { id: 'c', name: 'County', level: 'county', rate: 0.015, item_cap: 5000, is_active: true }
const city: TaxRate = { id: 'x', name: 'City', level: 'city', rate: 0.0025, item_cap: null, is_active: false }
const capNote = (cap: number) => `(first $${cap} of each item)`

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
  it('names each active rate and words a cap', () => {
    expect(taxBreakdown([state, county, city], capNote)).toBe(
      'State 6% + County 1.5% (first $5000 of each item)',
    )
  })
})

describe('taxRateInputSchema', () => {
  const input = { name: ' Florida ', level: 'state', percent: '6', item_cap: '', is_active: true }
  it('stores a typed percent as a fraction, a blank cap as none', () => {
    expect(taxRateInputSchema.parse(input)).toEqual({
      name: 'Florida',
      level: 'state',
      percent: 0.06,
      item_cap: null,
      is_active: true,
    })
    expect(taxRateInputSchema.parse({ ...input, percent: '1.5' }).percent).toBe(0.015)
    expect(taxRateInputSchema.parse({ ...input, percent: '6.25' }).percent).toBe(0.0625)
  })
  it('keeps a cap in dollars and cents', () => {
    expect(taxRateInputSchema.parse({ ...input, item_cap: '5000' }).item_cap).toBe(5000)
    expect(taxRateInputSchema.parse({ ...input, item_cap: '1600.50' }).item_cap).toBe(1600.5)
    expect(taxRateInputSchema.parse({ ...input, item_cap: undefined }).item_cap).toBeNull()
  })
  it('refuses a cap of zero or less', () => {
    expect(taxRateInputSchema.safeParse({ ...input, item_cap: '0' }).success).toBe(false)
    expect(taxRateInputSchema.safeParse({ ...input, item_cap: '-5' }).success).toBe(false)
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

describe('allocateDiscount', () => {
  it('spreads a discount by value, to the cent', () => {
    // $100 off a $10,000 + $100 cart: 99.01 and 0.99.
    expect(allocateDiscount([1000000, 10000], 10000)).toEqual([990099, 9901])
  })
  it('gives the leftover cent to the largest line', () => {
    // $1 off three $33.33-ish lines: 33 + 33 + 33 = 99 cents, 1 left over.
    const net = allocateDiscount([3333, 3333, 3334], 100)
    expect(net.reduce((a, b) => a + b, 0)).toBe(10000 - 100)
    expect(net).toEqual([3300, 3300, 3300])
  })
  it('never discounts below zero', () => {
    expect(allocateDiscount([500, 500], 5000)).toEqual([0, 0])
    expect(allocateDiscount([], 100)).toEqual([])
  })
})

/**
 * Every expected number in this block was produced by the database's
 * sales_tax_quote() / sale_create() in the 0095 dry run (2026-11-22) with a
 * 6% state line and a 1.5% county line capped at $5,000 per item. If one of
 * these changes, the screen and the database no longer agree.
 */
describe('quoteSaleTax — same numbers as the database (0095 dry run)', () => {
  const rates = [state, county]
  const q = (lines: Array<[number, number]>, discount = 0) =>
    quoteSaleTax(lines.map(([quantity, lineTotal]) => ({ quantity, lineTotal })), discount, rates)

  it('one $10,000 item: county tax stops at $5,000', () => {
    const r = q([[1, 10000]])
    expect(r.tax).toBe(675)
    expect(r.rate).toBe(0.075)
    expect(r.lineTax).toEqual([675])
    expect(r.parts.map((p) => [p.name, p.taxable, p.tax])).toEqual([
      ['State', 10000, 600],
      ['County', 5000, 75],
    ])
  })

  it('the cap is per item, not per sale', () => {
    const r = q([[1, 10000], [1, 100]])
    expect(r.tax).toBe(682.5)
    expect(r.lineTax).toEqual([675, 7.5])
    expect(r.parts.map((p) => [p.taxable, p.tax])).toEqual([[10100, 606], [5100, 76.5]])
  })

  it('two units on one line get two caps', () => {
    const r = q([[2, 12000]])
    expect(r.tax).toBe(870)
    expect(r.parts[1]).toMatchObject({ taxable: 10000, tax: 150 })
  })

  it('a fractional quantity scales the cap', () => {
    const r = q([[2.5, 20000]])
    expect(r.tax).toBe(1387.5)
    expect(r.parts[1]).toMatchObject({ taxable: 12500, tax: 187.5 })
  })

  it('rounds once on the whole sale; the split still adds up', () => {
    // 20 cents: 1.2 + 0.3 = 1.5 cents → 2. The state line takes the cent.
    const r = q([[1, 0.2]])
    expect(r.tax).toBe(0.02)
    expect(r.parts.map((p) => p.tax)).toEqual([0.02, 0])
    expect(r.lineTax).toEqual([0.02])
  })

  it('three lines that add to $100', () => {
    const r = q([[1, 33.33], [1, 33.33], [1, 33.34]])
    expect(r.tax).toBe(7.5)
    expect(r.lineTax).toEqual([2.5, 2.5, 2.5])
    expect(r.parts.map((p) => p.tax)).toEqual([6, 1.5])
  })

  it('a cart discount is spread over the lines before the cap', () => {
    const r = q([[1, 10000], [1, 100]], 100)
    expect(r.net).toEqual([9900.99, 99.01])
    expect(r.tax).toBe(676.49)
    expect(r.lineTax).toEqual([669.06, 7.43])
    expect(r.parts.map((p) => [p.taxable, p.tax])).toEqual([[10000, 600], [5099.01, 76.49]])
  })

  it('an empty cart owes nothing', () => {
    const r = q([])
    expect(r.tax).toBe(0)
    expect(r.rate).toBe(0.075)
    expect(r.lineTax).toEqual([])
  })

  it('skips tax lines that are switched off', () => {
    const r = quoteSaleTax([{ quantity: 1, lineTotal: 10000 }], 0, [state, { ...county, is_active: false }])
    expect(r.tax).toBe(600)
    expect(r.rate).toBe(0.06)
  })
})

describe('quoteSaleTax — no caps is the old formula', () => {
  const uncapped = [state, { ...county, item_cap: null }]
  it('equals (subtotal − discount) × rate for many carts', () => {
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let n = 0; n < 400; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        quantity: 1 + Math.floor(rand() * 3),
        lineTotal: Math.round(rand() * 500000) / 100,
      }))
      const subtotal = Math.round(lines.reduce((a, l) => a + l.lineTotal, 0) * 100) / 100
      const discount = rand() < 0.5 ? 0 : Math.round(rand() * subtotal * 50) / 100
      const old = computeTotal({ subtotal, discount, tax_rate: 0.075 })
      const now = quoteSaleTax(lines, discount, uncapped)
      expect(now.tax, JSON.stringify({ lines, discount })).toBe(old.tax)
      expect(Math.round(now.lineTax.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round(now.tax * 100))
      expect(Math.round(now.parts.reduce((a, p) => a + p.tax, 0) * 100)).toBe(Math.round(now.tax * 100))
    }
  })
})

describe('the sale screen', () => {
  const shop: ShopTax = { percent: '7.5', rates: [state, county] }
  const ring = { quantity: 1, unit_price: 10000, line_discount: 0 }

  it('uses the shop tax lines while the Tax field shows the shop rate', () => {
    expect(taxModeFor(0.075, shop)).toBe('shop')
    expect(taxModeFor(7.5 / 100, shop)).toBe('shop')
    const t = computeCartTotals({ lines: [ring], discount: 0, taxFraction: 0.075, shop })
    expect(t).toMatchObject({ mode: 'shop', subtotal: 10000, tax: 675, total: 10675 })
  })

  it('charges one flat rate once the clerk types another', () => {
    expect(taxModeFor(0.07, shop)).toBe('flat')
    expect(taxModeFor(0, shop)).toBe('flat')
    const t = computeCartTotals({ lines: [ring], discount: 0, taxFraction: 0.07, shop })
    expect(t).toMatchObject({ mode: 'flat', tax: 700, total: 10700 })
  })

  it('is flat when the shop has no tax lines', () => {
    const none: ShopTax = { percent: '0', rates: [] }
    expect(taxModeFor(0, none)).toBe('flat')
    expect(computeCartTotals({ lines: [ring], discount: 0, taxFraction: 0, shop: none })).toMatchObject({
      mode: 'flat',
      tax: 0,
      total: 10000,
    })
  })

  it('matches the database on a discounted two-line cart', () => {
    const t = computeCartTotals({
      lines: [ring, { quantity: 1, unit_price: 100, line_discount: 0 }],
      discount: 100,
      taxFraction: 0.075,
      shop,
    })
    expect(t).toMatchObject({ subtotal: 10100, discount: 100, tax: 676.49, total: 10676.49 })
  })
})
