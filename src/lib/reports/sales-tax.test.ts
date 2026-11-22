import { describe, expect, it } from 'vitest'
import type { SaleTaxPart } from '@/lib/pos/sales-tax'
import {
  buildSalesTaxReport,
  distributeCents,
  refundByTaxLine,
  type TaxReturnInput,
  type TaxSaleInput,
  type TaxSaleItemInput,
} from './sales-tax'
import { salesTaxCsvRows, salesTaxPdfRows } from './sales-tax-export'

// November in New York (UTC-5 after Nov 1): the bounds the report gets.
const FROM = '2026-11-01T04:00:00.000Z'
const TO = '2026-12-01T05:00:00.000Z'

const state = (taxable: number): SaleTaxPart => ({
  name: 'State', level: 'state', rate: 0.06, item_cap: null, taxable, tax: Math.round(taxable * 6) / 100,
})
const county = (taxable: number, cap: number | null = null): SaleTaxPart => ({
  name: 'County', level: 'county', rate: 0.015, item_cap: cap, taxable, tax: Math.round(taxable * 1.5) / 100,
})

let n = 0
function sale(over: Partial<TaxSaleInput> = {}): TaxSaleInput {
  n += 1
  return {
    id: `s${n}`,
    tenant_id: 't',
    sale_number: `S-${String(n).padStart(6, '0')}`,
    status: 'completed',
    completed_at: '2026-11-10T15:00:00Z',
    voided_at: null,
    customer_name: null,
    base: 200,
    discount: 0,
    tax: 15,
    tax_rate: 0.075,
    exempt: null,
    parts: [state(200), county(200)],
    ...over,
  }
}
const build = (sales: TaxSaleInput[], returns: TaxReturnInput[] = [], items: TaxSaleItemInput[] = []) =>
  buildSalesTaxReport({ sales, items, returns, fromIso: FROM, toExclusiveIso: TO })

describe('distributeCents', () => {
  it('adds up exactly, leftover cents to the largest remainders', () => {
    expect(distributeCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(distributeCents(1500, [12, 3])).toEqual([1200, 300])
    expect(distributeCents(1, [6, 1.5]).reduce((a, b) => a + b, 0)).toBe(1)
  })
  it('gives nothing when there is nothing to weigh by', () => {
    expect(distributeCents(500, [0, 0])).toEqual([0, 0])
    expect(distributeCents(0, [3, 1])).toEqual([0, 0])
  })
})

describe('tax collected, by tax line', () => {
  it('adds each sale under the tax lines it kept', () => {
    // The second is the real S-000017 shape: $200 → $12.00 + $3.00.
    const r = build([sale(), sale()])
    expect(r.totals).toMatchObject({ sales: 2, gross: 400, exempt: 0, taxable: 400, tax_collected: 30, net_tax: 30 })
    expect(r.lines.map((l) => [l.name, l.level, l.taxable, l.tax, l.net_tax])).toEqual([
      ['State', 'state', 400, 24, 24],
      ['County', 'county', 400, 6, 6],
    ])
  })

  it('keeps a capped line on what it was really charged on', () => {
    // $10,000 item, county only on the first $5,000.
    const r = build([sale({ base: 10000, tax: 675, parts: [state(10000), county(5000, 5000)] })])
    const [st, co] = r.lines
    expect([st.taxable, st.tax]).toEqual([10000, 600])
    expect([co.taxable, co.tax]).toEqual([5000, 75])
    // The lines add up to the tax collected.
    expect(r.lines.reduce((a, l) => a + l.tax, 0)).toBe(r.totals.tax_collected)
  })

  it('lists a sale with no split under its one rate', () => {
    const r = build([sale({ base: 10, tax: 0.75, parts: [] }), sale({ base: 100, tax: 7, tax_rate: 0.07, parts: [] })])
    expect(r.lines.map((l) => [l.flat, l.level, l.rate, l.taxable, l.tax])).toEqual([
      [true, null, 0.07, 100, 7],
      [true, null, 0.075, 10, 0.75],
    ])
  })

  it('keeps two rates of the same tax apart (the shop changed its rate mid-period)', () => {
    const newCounty: SaleTaxPart = { ...county(200), rate: 0.01, tax: 2 }
    const r = build([sale(), sale({ tax: 14, parts: [state(200), newCounty] })])
    expect(r.lines.filter((l) => l.name === 'County').map((l) => [l.rate, l.tax])).toEqual([
      [0.01, 2],
      [0.015, 3],
    ])
  })

  it('does not drift over many sales', () => {
    const many = Array.from({ length: 300 }, () => sale({ base: 0.1, tax: 0.01, parts: [state(0.1), county(0.1)] }))
    expect(build(many).totals).toMatchObject({ gross: 30, tax_collected: 3 })
  })
})

describe('what counts in the dates', () => {
  it('counts a sale the day it was completed, in the shop day', () => {
    const r = build([
      sale({ completed_at: '2026-11-01T03:59:59Z' }), // Oct 31, 11:59 PM in the shop
      sale({ completed_at: '2026-11-01T04:00:00Z' }), // Nov 1, midnight
      sale({ completed_at: '2026-12-01T04:59:59Z' }), // Nov 30, 11:59 PM
      sale({ completed_at: '2026-12-01T05:00:00Z' }), // Dec 1
    ])
    expect(r.totals.sales).toBe(2)
  })

  it('leaves out an open sale or layaway: its tax is not collected yet', () => {
    const r = build([sale({ status: 'open', completed_at: null })])
    expect(r.totals).toMatchObject({ sales: 0, tax_collected: 0 })
  })

  it('leaves out a sale completed and voided inside the dates', () => {
    const r = build([sale({ status: 'voided', voided_at: '2026-11-10T16:00:00Z' })])
    expect(r.totals).toMatchObject({ sales: 0, gross: 0, tax_collected: 0, tax_refunded: 0, net_tax: 0 })
    expect(r.documents).toEqual([])
  })

  it('still counts a sale voided after the dates — that later period gives it back', () => {
    const r = build([sale({ status: 'voided', voided_at: '2026-12-03T16:00:00Z' })])
    expect(r.totals).toMatchObject({ sales: 1, tax_collected: 15, tax_refunded: 0 })
  })

  it('gives back a sale counted in an earlier period when it is voided in the dates', () => {
    const r = build([sale({ status: 'voided', completed_at: '2026-10-20T15:00:00Z', voided_at: '2026-11-05T15:00:00Z' })])
    expect(r.totals).toMatchObject({ sales: 0, gross: 0, tax_collected: 0, returns: 200, tax_refunded: 15, net_tax: -15 })
    expect(r.lines.map((l) => [l.name, l.tax, l.tax_refunded, l.net_tax, l.net_taxable])).toEqual([
      ['State', 0, 12, -12, -200],
      ['County', 0, 3, -3, -200],
    ])
    expect(r.documents[0]).toMatchObject({ kind: 'void', before_tax: -200, tax: -15 })
  })

  it('nets to zero for a voided sale however the periods are cut', () => {
    const s = sale({ status: 'voided', completed_at: '2026-10-20T15:00:00Z', voided_at: '2026-11-05T15:00:00Z' })
    const october = buildSalesTaxReport({ sales: [s], items: [], returns: [], fromIso: '2026-10-01T04:00:00Z', toExclusiveIso: FROM })
    const november = build([s])
    const both = buildSalesTaxReport({ sales: [s], items: [], returns: [], fromIso: '2026-10-01T04:00:00Z', toExclusiveIso: TO })
    expect(october.totals.net_tax + november.totals.net_tax).toBe(0)
    expect(both.totals.net_tax).toBe(0)
  })
})

describe('sales with no tax', () => {
  it('groups exempt sales by reason and keeps the certificate', () => {
    const r = build([
      sale({ base: 5, tax: 0, tax_rate: 0, parts: [], exempt: { reason: 'resale', certificate: '85-801' } }),
      sale({ base: 95, tax: 0, tax_rate: 0, parts: [], exempt: { reason: 'resale', certificate: null } }),
      sale({ base: 40, tax: 0, tax_rate: 0, parts: [], exempt: { reason: 'government', certificate: 'G-1' } }),
      sale(),
    ])
    expect(r.totals).toMatchObject({ gross: 340, exempt: 140, untaxed: 0, taxable: 200, tax_collected: 15 })
    expect(r.noTax).toEqual([
      { reason: 'resale', count: 2, amount: 100 },
      { reason: 'government', count: 1, amount: 40 },
    ])
    expect(r.documents.filter((d) => d.exempt_reason).map((d) => d.certificate).sort()).toEqual(['85-801', 'G-1', null].sort())
    // An exempt sale is under no tax line.
    expect(r.lines.every((l) => l.taxable === 200)).toBe(true)
  })

  it('shows a sale with tax set to 0 by hand as "no reason", last', () => {
    const r = build([
      sale({ base: 50, tax: 0, tax_rate: 0, parts: [] }),
      sale({ base: 20, tax: 0, tax_rate: 0, parts: [], exempt: { reason: 'other', certificate: null } }),
    ])
    expect(r.totals).toMatchObject({ exempt: 20, untaxed: 50, taxable: 0 })
    expect(r.noTax).toEqual([
      { reason: 'other', count: 1, amount: 20 },
      { reason: null, count: 1, amount: 50 },
    ])
    expect(r.documents.find((d) => d.before_tax === 50)?.untaxed).toBe(true)
  })
})

describe('returns', () => {
  const s = () => sale({ id: 'sr', base: 200, tax: 15 })
  const items: TaxSaleItemInput[] = [{ id: 'i1', sale_id: 'sr', quantity: 1, line_total: 200, position: 0 }]
  const ret = (over: Partial<TaxReturnInput> = {}): TaxReturnInput => ({
    id: 'r1', sale_id: 'sr', return_number: 'R-000001', created_at: '2026-11-12T15:00:00Z',
    subtotal: 200, tax: 15, items: [{ sale_item_id: 'i1', quantity: 1 }], ...over,
  })

  it('gives the tax back on each tax line the day the return was issued', () => {
    const r = build([s()], [ret()], items)
    expect(r.totals).toMatchObject({ tax_collected: 15, returns: 200, tax_refunded: 15, net_tax: 0 })
    expect(r.lines.map((l) => [l.name, l.tax_refunded, l.net_tax, l.net_taxable])).toEqual([
      ['State', 12, 0, 0],
      ['County', 3, 0, 0],
    ])
    expect(r.documents.map((d) => [d.kind, d.number, d.tax])).toEqual([
      ['return', 'R-000001', -15],
      ['sale', expect.any(String), 15],
    ])
  })

  it('counts a return of an earlier sale in the period of the return', () => {
    const old = sale({ id: 'sr', completed_at: '2026-10-05T15:00:00Z' })
    const r = build([old], [ret()], items)
    expect(r.totals).toMatchObject({ sales: 0, tax_collected: 0, tax_refunded: 15, net_tax: -15 })
  })

  it('ignores a return issued outside the dates', () => {
    const r = build([s()], [ret({ created_at: '2026-12-02T15:00:00Z' })], items)
    expect(r.totals).toMatchObject({ tax_refunded: 0, net_tax: 15 })
  })

  it('leaves out the return of a sale that is itself left out', () => {
    const voided = sale({ id: 'sr', status: 'voided', voided_at: '2026-11-20T15:00:00Z' })
    const r = build([voided], [ret()], items)
    expect(r.totals).toMatchObject({ tax_collected: 0, tax_refunded: 0, net_tax: 0 })
  })

  it('a void gives back only what the returns had not', () => {
    // Completed in October, half returned in October, voided in November.
    const old = sale({ id: 'sr', status: 'voided', completed_at: '2026-10-05T15:00:00Z', voided_at: '2026-11-08T15:00:00Z', base: 200, tax: 15 })
    const two: TaxSaleItemInput[] = [
      { id: 'i1', sale_id: 'sr', quantity: 1, line_total: 100, position: 0 },
      { id: 'i2', sale_id: 'sr', quantity: 1, line_total: 100, position: 1 },
    ]
    const half = ret({ created_at: '2026-10-09T15:00:00Z', subtotal: 100, tax: 7.5, items: [{ sale_item_id: 'i1', quantity: 1 }] })
    const r = build([old], [half], two)
    expect(r.totals).toMatchObject({ returns: 100, tax_refunded: 7.5, net_tax: -7.5 })
    expect(r.lines.map((l) => [l.name, l.tax_refunded])).toEqual([
      ['State', 6],
      ['County', 1.5],
    ])
  })

  it('gives back a flat-rate sale under its one rate', () => {
    const flat = sale({ id: 'sr', base: 100, tax: 7, tax_rate: 0.07, parts: [] })
    const r = build([flat], [ret({ subtotal: 100, tax: 7 })], [{ id: 'i1', sale_id: 'sr', quantity: 1, line_total: 100, position: 0 }])
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ flat: true, rate: 0.07, tax: 7, tax_refunded: 7, net_tax: 0, net_taxable: 0 })
  })

  it('counts the return of an exempt sale as a return with no tax', () => {
    const ex = sale({ id: 'sr', base: 80, tax: 0, tax_rate: 0, parts: [], exempt: { reason: 'resale', certificate: null } })
    const r = build([ex], [ret({ subtotal: 80, tax: 0 })], [{ id: 'i1', sale_id: 'sr', quantity: 1, line_total: 80, position: 0 }])
    expect(r.totals).toMatchObject({ exempt: 80, returns: 80, tax_refunded: 0 })
    expect(r.lines).toEqual([])
  })
})

describe('the exports', () => {
  const report = () =>
    build(
      [
        sale({ id: 'a', sale_number: 'S-000017' }),
        sale({ id: 'b', sale_number: 'S-000016', base: 5, tax: 0, tax_rate: 0, parts: [], exempt: { reason: 'resale', certificate: '85-801' } }),
        sale({ id: 'c', sale_number: 'S-000009', base: 10, tax: 0.75, parts: [] }),
        sale({ id: 'd', sale_number: 'S-000003', base: 50, tax: 0, tax_rate: 0, parts: [] }),
      ],
      [{ id: 'r1', sale_id: 'a', return_number: 'R-000001', created_at: '2026-11-12T15:00:00Z', subtotal: 200, tax: 15, items: [{ sale_item_id: 'i1', quantity: 1 }] }],
      [{ id: 'i1', sale_id: 'a', quantity: 1, line_total: 200, position: 0 }],
    )

  it('CSV: one row per document and tax line; the tax column adds up to net tax', () => {
    const rows = salesTaxCsvRows(report())
    expect(rows.filter((r) => r.sale_number === 'S-000017' && r.type === 'sale').map((r) => [r.tax_line, r.rate, r.amount, r.tax])).toEqual([
      ['State', 0.06, 200, 12],
      ['County', 0.015, 200, 3],
    ])
    expect(rows.find((r) => r.sale_number === 'S-000016')).toMatchObject({ tax_line: 'exempt', amount: 5, tax: 0, exempt_reason: 'resale', certificate: '85-801' })
    expect(rows.find((r) => r.sale_number === 'S-000009')).toMatchObject({ tax_line: 'One rate, no split (7.5%)', amount: 10, tax: 0.75 })
    expect(rows.find((r) => r.sale_number === 'S-000003')).toMatchObject({ tax_line: 'no tax', amount: 50 })
    expect(rows.filter((r) => r.type === 'return').map((r) => [r.number, r.tax_line, r.amount, r.tax])).toEqual([
      ['R-000001', 'State', -200, -12],
      ['R-000001', 'County', -200, -3],
    ])
    const cents = rows.reduce((a, r) => a + Math.round(r.tax * 100), 0)
    expect(cents / 100).toBe(report().totals.net_tax)
  })

  it('PDF: the tax lines, then the sales with no tax by reason', () => {
    expect(salesTaxPdfRows(report()).map((r) => [r.section, r.label, r.rate, r.count, r.amount, r.tax, r.tax_refunded, r.net_tax])).toEqual([
      ['TAX', 'State', '6%', '', 200, 12, 12, 0],
      ['TAX', 'County', '1.5%', '', 200, 3, 3, 0],
      ['TAX', 'One rate, no split (7.5%)', '7.5%', '', 10, 0.75, 0, 0.75],
      ['NO TAX', 'Resale', '', '1', 5, null, null, null],
      ['NO TAX', 'No reason recorded', '', '1', 50, null, null, null],
    ])
  })
})

describe('refundByTaxLine (a capped tax gives back only what it took)', () => {
  // One sale: a $10,000 ring and a $1,000 chain. County stops at $5,000 per item.
  const parts = [state(11000), county(6000, 5000)]
  const items: TaxSaleItemInput[] = [
    { id: 'ring', sale_id: 's', quantity: 1, line_total: 10000, position: 0 },
    { id: 'chain', sale_id: 's', quantity: 1, line_total: 1000, position: 1 },
  ]
  const cents = (a: number[]) => a.map((c) => c / 100)

  it('returning the ring gives back state on $10,000 and county on $5,000', () => {
    const by = refundByTaxLine({ discount: 0, parts }, items, { tax: 675, items: [{ sale_item_id: 'ring', quantity: 1 }] })
    expect(cents(by.taxable)).toEqual([10000, 5000])
    expect(cents(by.tax)).toEqual([600, 75])
  })

  it('returning the chain gives back both taxes on $1,000', () => {
    const by = refundByTaxLine({ discount: 0, parts }, items, { tax: 75, items: [{ sale_item_id: 'chain', quantity: 1 }] })
    expect(cents(by.taxable)).toEqual([1000, 1000])
    expect(cents(by.tax)).toEqual([60, 15])
  })

  it('the two returns together give back exactly what the sale was charged', () => {
    const a = refundByTaxLine({ discount: 0, parts }, items, { tax: 675, items: [{ sale_item_id: 'ring', quantity: 1 }] })
    const b = refundByTaxLine({ discount: 0, parts }, items, { tax: 75, items: [{ sale_item_id: 'chain', quantity: 1 }] })
    expect(cents([a.tax[0] + b.tax[0], a.tax[1] + b.tax[1]])).toEqual([parts[0].tax, parts[1].tax])
  })

  it('sees the cart discount: each item is refunded on what it sold for', () => {
    // $1,100 off the $11,000 sale: the ring sold for $9,000, the chain for $900.
    const disc = [state(9900), county(5900, 5000)]
    const by = refundByTaxLine({ discount: 1100, parts: disc }, items, { tax: 67.5, items: [{ sale_item_id: 'chain', quantity: 1 }] })
    expect(cents(by.taxable)).toEqual([900, 900])
    expect(cents(by.tax)).toEqual([54, 13.5])
  })

  it('part of a quantity gives back that part', () => {
    const batteries: TaxSaleItemInput[] = [{ id: 'b', sale_id: 's', quantity: 4, line_total: 40, position: 0 }]
    const by = refundByTaxLine({ discount: 0, parts: [state(40), county(40)] }, batteries, {
      tax: 0.75,
      items: [{ sale_item_id: 'b', quantity: 1 }],
    })
    expect(cents(by.taxable)).toEqual([10, 10])
    expect(cents(by.tax)).toEqual([0.6, 0.15])
  })

  it('always adds up to the tax of the return', () => {
    const by = refundByTaxLine({ discount: 0, parts: [state(9.99), county(9.99)] }, [
      { id: 'x', sale_id: 's', quantity: 3, line_total: 9.99, position: 0 },
    ], { tax: 0.25, items: [{ sale_item_id: 'x', quantity: 1 }] })
    expect(by.tax.reduce((a, b) => a + b, 0)).toBe(25)
  })
})
