import { describe, expect, it } from 'vitest'
import {
  daysUntilExpiry,
  lifetimeCommission,
  lifetimeGross,
  openBalance,
  splitConsignment,
} from './math'

describe('splitConsignment', () => {
  it('splits a clean amount at the agreed rate', () => {
    expect(splitConsignment({ gross: 1000, commissionPct: 0.2 })).toEqual({
      gross: 1000,
      commission: 200,
      payable: 800,
    })
  })

  it('never loses a cent — commission + payable is always the gross', () => {
    for (const gross of [33.33, 0.01, 999.99, 12345.67]) {
      for (const pct of [0.15, 0.2, 0.333, 0.05]) {
        const s = splitConsignment({ gross, commissionPct: pct })
        expect(s.commission + s.payable).toBeCloseTo(s.gross, 4)
      }
    }
  })

  it('pays the whole gross when the shop takes no commission', () => {
    expect(splitConsignment({ gross: 250, commissionPct: 0 })).toEqual({
      gross: 250,
      commission: 0,
      payable: 250,
    })
  })

  it('clamps a nonsense rate into 0..1 instead of inventing money', () => {
    expect(splitConsignment({ gross: 100, commissionPct: 1.5 }).payable).toBe(0)
    expect(splitConsignment({ gross: 100, commissionPct: -0.5 }).payable).toBe(
      100,
    )
  })
})

describe('openBalance', () => {
  it('sums only the unpaid rows', () => {
    expect(
      openBalance([
        { payable_amount: 800, status: 'open' },
        { payable_amount: 400, status: 'paid' },
        { payable_amount: '120.5000', status: 'open' },
      ]),
    ).toBe(920.5)
  })

  it('goes negative when a reversal lands after the payout', () => {
    // Accrual was paid out; then the buyer returned the item.
    expect(
      openBalance([
        { payable_amount: 800, status: 'paid' },
        { payable_amount: -800, status: 'open' },
      ]),
    ).toBe(-800)
  })

  it('is zero for a consignor with no ledger', () => {
    expect(openBalance([])).toBe(0)
  })
})

describe('lifetime totals', () => {
  const rows = [
    { gross_amount: 1000, commission_amount: 200 },
    { gross_amount: -250, commission_amount: -50 },
  ]

  it('nets reversals out of gross', () => {
    expect(lifetimeGross(rows)).toBe(750)
  })

  it('nets reversals out of commission earned', () => {
    expect(lifetimeCommission(rows)).toBe(150)
  })
})

describe('daysUntilExpiry', () => {
  it('counts forward to the agreed end date', () => {
    expect(daysUntilExpiry('2026-10-01', '2026-09-19')).toBe(12)
  })

  it('is zero on the last day', () => {
    expect(daysUntilExpiry('2026-09-19', '2026-09-19')).toBe(0)
  })

  it('goes negative once the agreement has lapsed', () => {
    expect(daysUntilExpiry('2026-09-01', '2026-09-19')).toBe(-18)
  })

  it('is null when no end date was agreed', () => {
    expect(daysUntilExpiry(null, '2026-09-19')).toBeNull()
  })
})
