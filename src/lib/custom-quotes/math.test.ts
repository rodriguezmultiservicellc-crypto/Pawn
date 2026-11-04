import { describe, expect, it } from 'vitest'
import {
  applyTargetMargin,
  depositSplit,
  expiryDate,
  isExpired,
  laborPrice,
  lineTotals,
  marginBelowMinimum,
  metalLabel,
  metalLineCost,
  priceFromCost,
  quoteTotals,
  type QuoteLineCalc,
} from './math'

const metal: QuoteLineCalc = { kind: 'metal', quantity: 6.2, unit_cost: 73.5536, unit_price: 0, price_locked: false }
const wax: QuoteLineCalc = { kind: 'wax', quantity: 1, unit_cost: 25, unit_price: 0, price_locked: false }
const labor: QuoteLineCalc = { kind: 'labor', quantity: 2, unit_cost: 0, unit_price: 75, price_locked: false }
const engraving: QuoteLineCalc = { kind: 'extra', quantity: 1, unit_cost: 0, unit_price: 40, price_locked: true }

describe('lineTotals / quoteTotals', () => {
  it('multiplies by quantity and rounds to 4 dp', () => {
    expect(lineTotals(metal)).toEqual({ cost_total: 456.0323, price_total: 0 })
    expect(lineTotals(labor)).toEqual({ cost_total: 0, price_total: 150 })
  })
  it('computes keep and margin on price', () => {
    const t = quoteTotals([
      { ...metal, unit_price: 100 }, // 620 price, 456.0323 cost
      labor, // 150 price, 0 cost
    ])
    expect(t.cost).toBe(456.0323)
    expect(t.price).toBe(770)
    expect(t.keep).toBe(313.9677)
    expect(t.marginPct).toBeCloseTo(0.4078, 4)
  })
  it('reports 0 margin with no price yet', () => {
    expect(quoteTotals([metal]).marginPct).toBe(0)
    expect(quoteTotals([]).price).toBe(0)
  })
  it('ignores negative or NaN inputs instead of inventing money', () => {
    expect(lineTotals({ quantity: -3, unit_cost: 10, unit_price: NaN })).toEqual({ cost_total: 0, price_total: 0 })
  })
})

describe('priceFromCost / applyTargetMargin', () => {
  it('prices cost at the target margin', () => {
    expect(priceFromCost(50, 0.5)).toBe(100)
    expect(priceFromCost(73.5536, 0.4)).toBe(122.5893)
  })
  it('never divides by zero at a silly margin', () => {
    expect(priceFromCost(100, 1)).toBe(2000) // clamped to 0.95
    expect(priceFromCost(100, 2)).toBe(2000)
    expect(priceFromCost(100, -1)).toBe(100)
  })
  it('re-prices unlocked cost lines, leaves locked and pure-price lines alone', () => {
    const out = applyTargetMargin([metal, wax, labor, engraving], 0.5)
    expect(out[0].unit_price).toBe(147.1072)
    expect(out[1].unit_price).toBe(50)
    expect(out[2].unit_price).toBe(75) // no cost → untouched
    expect(out[3].unit_price).toBe(40) // locked → untouched
    // Quote margin lands AT or ABOVE the target because pure-price lines add only to price.
    expect(quoteTotals(out).marginPct).toBeGreaterThanOrEqual(0.5)
  })
  it('a locked line can pull the quote below the minimum — and the check says so', () => {
    const cheap = applyTargetMargin([{ ...metal, unit_price: 80, price_locked: true }], 0.5)
    const t = quoteTotals(cheap)
    expect(marginBelowMinimum(t.marginPct, 0.3)).toBe(true)
    expect(marginBelowMinimum(0.3, 0.3)).toBe(false)
  })
})

describe('deposit / labor / metal / dates', () => {
  it('splits a deposit and keeps the balance non-negative', () => {
    expect(depositSplit(640, 0.5)).toEqual({ deposit: 320, balance: 320 })
    expect(depositSplit(99.99, 0.3333)).toEqual({ deposit: 33.3267, balance: 66.6633 })
    expect(depositSplit(100, 1.5)).toEqual({ deposit: 100, balance: 0 })
  })
  it('labor by the hour or flat', () => {
    expect(laborPrice({ mode: 'hourly', hours: 2.5, rate: 75 })).toBe(187.5)
    expect(laborPrice({ mode: 'flat', flat: 120 })).toBe(120)
    expect(laborPrice({ mode: 'hourly', hours: 2 })).toBe(0)
  })
  it('metal cost is grams × frozen spot', () => {
    expect(metalLineCost(6.2, 73.5536)).toBe(456.0323)
    expect(metalLineCost(0, 73.5536)).toBe(0)
  })
  it('expiry date adds whole days to a calendar date', () => {
    expect(expiryDate('2026-11-03', 14)).toBe('2026-11-17')
    expect(expiryDate('2026-12-25', 10)).toBe('2027-01-04')
    expect(expiryDate('2026-11-03T21:10:00Z', 0)).toBe('2026-11-03')
    expect(isExpired('2026-11-17', '2026-11-18')).toBe(true)
    expect(isExpired('2026-11-17', '2026-11-17')).toBe(false)
    expect(isExpired(null, '2026-11-18')).toBe(false)
  })
  it('labels the frozen metal', () => {
    expect(metalLabel('gold', '14')).toBe('Gold 14k')
    expect(metalLabel('white_gold', '18')).toBe('White gold 18k')
    expect(metalLabel('silver', null)).toBe('Silver')
  })
})
