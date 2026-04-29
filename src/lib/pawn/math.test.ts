/**
 * Pure-logic tests for the pawn math helpers.
 *
 * These functions back every payoff calculation surface — staff detail
 * page, portal pay-by-link, Stripe webhook, cron maturity reminders,
 * and the receipt PDFs. A regression here under-bills or over-bills
 * customers, so the regression bar is high. Tests focus on:
 *
 *   1. The 4-decimal-place rounding contract.
 *   2. The min_monthly_charge floor (Session 12 — Stripe webhook
 *      under-billing was the explicit incident this guards against).
 *   3. Date math at UTC midnight (no timezone drift).
 *   4. Payoff arithmetic across partial payments + accrual.
 *   5. Interest-first payment splitting.
 */

import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  appliedPayments,
  dailyRateFromMonthly,
  daysBetween,
  interestAccrued,
  payoffBalance,
  r4,
  splitPayment,
  toMoney,
  todayDateString,
} from './math'

describe('r4 / toMoney', () => {
  it('rounds to 4 decimal places half-away-from-zero', () => {
    expect(r4(1.23456)).toBe(1.2346)
    expect(r4(1.23454)).toBe(1.2345)
    expect(r4(0)).toBe(0)
  })

  it('returns 0 for non-finite values', () => {
    expect(r4(NaN)).toBe(0)
    expect(r4(Infinity)).toBe(0)
    expect(r4(-Infinity)).toBe(0)
  })

  it('toMoney handles string Supabase NUMERIC payloads', () => {
    expect(toMoney('100.00')).toBe(100)
    expect(toMoney('100.12345')).toBe(100.1235)
    expect(toMoney('0.00')).toBe(0)
  })

  it('toMoney handles null/undefined as zero', () => {
    expect(toMoney(null)).toBe(0)
    expect(toMoney(undefined)).toBe(0)
  })
})

describe('dailyRateFromMonthly', () => {
  it('divides by 30', () => {
    expect(dailyRateFromMonthly(0.1)).toBeCloseTo(0.0033, 4)
    expect(dailyRateFromMonthly(0)).toBe(0)
  })
})

describe('interestAccrued', () => {
  it('zero principal or zero days → zero', () => {
    expect(interestAccrued(0, 0.1, 30)).toBe(0)
    expect(interestAccrued(100, 0.1, 0)).toBe(0)
    expect(interestAccrued(100, 0.1, -5)).toBe(0)
  })

  it('classic case: $1000 @ 10%/mo for 30 days → $100', () => {
    expect(interestAccrued(1000, 0.1, 30)).toBeCloseTo(100, 4)
  })

  it('partial month pro-rates straight-line', () => {
    // $1000 @ 10%/mo for 15 days → $50.
    expect(interestAccrued(1000, 0.1, 15)).toBeCloseTo(50, 4)
  })

  describe('min_monthly_charge floor (Session 12)', () => {
    it('floors a small principal at min/30 per day', () => {
      // $10 @ 10%/mo with $20 min:
      //   percentageDaily = 0.0333…
      //   minDaily        = 20/30 = 0.6667
      //   30 days → $20, 15 days → $10, 1 day → $0.6667.
      expect(interestAccrued(10, 0.1, 30, 20)).toBeCloseTo(20, 4)
      expect(interestAccrued(10, 0.1, 15, 20)).toBeCloseTo(10, 4)
      expect(interestAccrued(10, 0.1, 1, 20)).toBeCloseTo(0.6667, 4)
    })

    it('does NOT lower interest above the floor', () => {
      // $1000 @ 10%/mo with $20 min: percentage interest dominates.
      expect(interestAccrued(1000, 0.1, 30, 20)).toBeCloseTo(100, 4)
    })

    it('handles a zero rate with a min set (defensive)', () => {
      // Hypothetical: rate=0 + min=$15 → 30 days → $15.
      expect(interestAccrued(100, 0, 30, 15)).toBeCloseTo(15, 4)
      expect(interestAccrued(100, 0, 0, 15)).toBe(0)
    })

    it('treats min<=0 as no floor', () => {
      expect(interestAccrued(1000, 0.1, 30, 0)).toBeCloseTo(100, 4)
      expect(interestAccrued(1000, 0.1, 30, -5)).toBeCloseTo(100, 4)
    })
  })
})

describe('date helpers', () => {
  it('daysBetween: 1 day', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1)
  })

  it('daysBetween: negative when b precedes a', () => {
    expect(daysBetween('2026-01-10', '2026-01-01')).toBe(-9)
  })

  it('daysBetween: zero on same day', () => {
    expect(daysBetween('2026-04-29', '2026-04-29')).toBe(0)
  })

  it('daysBetween: crosses month boundary correctly', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
  })

  it('daysBetween: crosses year boundary correctly', () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('addDaysIso: forward', () => {
    expect(addDaysIso('2026-04-29', 1)).toBe('2026-04-30')
    expect(addDaysIso('2026-04-29', 30)).toBe('2026-05-29')
  })

  it('addDaysIso: backward', () => {
    expect(addDaysIso('2026-04-29', -29)).toBe('2026-03-31')
  })

  it('todayDateString: matches ISO date format', () => {
    const t = todayDateString()
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('appliedPayments', () => {
  it('sums splits across events', () => {
    const out = appliedPayments([
      { principal_paid: 50, interest_paid: 10, fees_paid: 0 },
      { principal_paid: 25, interest_paid: 5, fees_paid: 1 },
    ])
    expect(out.principalApplied).toBe(75)
    expect(out.interestApplied).toBe(15)
    expect(out.feesApplied).toBe(1)
  })

  it('handles string-shaped Supabase NUMERIC values', () => {
    const out = appliedPayments([
      // @ts-expect-error — runtime allows string from DB; Pick<LoanEventRow>
      // narrows to the generated type which uses string for NUMERIC.
      { principal_paid: '50.0000', interest_paid: '10.0000', fees_paid: '0' },
    ])
    expect(out.principalApplied).toBe(50)
    expect(out.interestApplied).toBe(10)
  })

  it('returns zeros for empty events', () => {
    const out = appliedPayments([])
    expect(out.principalApplied).toBe(0)
    expect(out.interestApplied).toBe(0)
    expect(out.feesApplied).toBe(0)
  })
})

describe('payoffBalance', () => {
  it('zero days elapsed → payoff = principal', () => {
    const r = payoffBalance({
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-04-29',
      today: '2026-04-29',
      events: [],
    })
    expect(r.payoff).toBe(1000)
    expect(r.interestAccrued).toBe(0)
  })

  it('classic 30-day payoff: $1000 + $100 interest', () => {
    const r = payoffBalance({
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [],
    })
    expect(r.interestAccrued).toBeCloseTo(100, 4)
    expect(r.payoff).toBeCloseTo(1100, 4)
  })

  it('netting: prior $50 interest payment reduces outstanding interest', () => {
    const r = payoffBalance({
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 0, interest_paid: 50, fees_paid: 0 },
      ],
    })
    expect(r.interestApplied).toBe(50)
    expect(r.interestOutstanding).toBeCloseTo(50, 4)
    expect(r.payoff).toBeCloseTo(1050, 4)
  })

  it('partial principal payment reduces principalOutstanding', () => {
    const r = payoffBalance({
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 200, interest_paid: 100, fees_paid: 0 },
      ],
    })
    expect(r.principalApplied).toBe(200)
    expect(r.interestApplied).toBe(100)
    expect(r.principalOutstanding).toBe(800)
    // Interest accrued $100, paid $100, outstanding $0.
    expect(r.interestOutstanding).toBe(0)
    expect(r.payoff).toBe(800)
  })

  it('overpayment of interest is clamped to 0 (treated as fees)', () => {
    const r = payoffBalance({
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 0, interest_paid: 200, fees_paid: 0 },
      ],
    })
    expect(r.interestOutstanding).toBe(0)
    expect(r.payoff).toBe(1000)
  })

  it('once principal is fully paid, outstanding interest does not bill', () => {
    const r = payoffBalance({
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 1000, interest_paid: 0, fees_paid: 0 },
      ],
    })
    expect(r.principalOutstanding).toBe(0)
    expect(r.payoff).toBe(0)
  })

  it('min_monthly_charge floor flows through payoff', () => {
    // $10 @ 10%/mo with $20 min, 30 days → $20 interest → $30 payoff.
    const r = payoffBalance({
      principal: 10,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [],
      minMonthlyCharge: 20,
    })
    expect(r.interestAccrued).toBeCloseTo(20, 4)
    expect(r.payoff).toBeCloseTo(30, 4)
  })

  it('min_monthly_charge null is treated as no floor', () => {
    // Same shape but min=null → percentage rate dominates ($1).
    const r = payoffBalance({
      principal: 10,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [],
      minMonthlyCharge: null,
    })
    expect(r.interestAccrued).toBeCloseTo(1, 4)
    expect(r.payoff).toBeCloseTo(11, 4)
  })
})

describe('splitPayment', () => {
  it('zero amount → zero split', () => {
    expect(splitPayment(0, 100)).toEqual({
      interest_paid: 0,
      principal_paid: 0,
    })
    expect(splitPayment(-10, 100)).toEqual({
      interest_paid: 0,
      principal_paid: 0,
    })
  })

  it('payment ≤ owed interest → all to interest', () => {
    expect(splitPayment(40, 100)).toEqual({
      interest_paid: 40,
      principal_paid: 0,
    })
    expect(splitPayment(100, 100)).toEqual({
      interest_paid: 100,
      principal_paid: 0,
    })
  })

  it('payment > owed interest → remainder to principal', () => {
    expect(splitPayment(150, 100)).toEqual({
      interest_paid: 100,
      principal_paid: 50,
    })
  })

  it('zero owed interest → all to principal', () => {
    expect(splitPayment(150, 0)).toEqual({
      interest_paid: 0,
      principal_paid: 150,
    })
  })

  it('clamps negative owed interest to 0', () => {
    expect(splitPayment(50, -10)).toEqual({
      interest_paid: 0,
      principal_paid: 50,
    })
  })
})
