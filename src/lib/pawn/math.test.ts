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
  allocateLoanPayment,
  appliedPayments,
  dailyRateFromMonthly,
  extensionCost,
  daysBetween,
  interestAccrued,
  payoffBalance,
  periodsToBringCurrent,
  planLoanPayment,
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

describe('allocateLoanPayment', () => {
  // $1,000 loan with $250 interest owed.
  const owed = { interestOutstanding: 250, principalOutstanding: 1000 }

  it('pays interest before any principal', () => {
    expect(allocateLoanPayment({ amount: 100, ...owed })).toEqual({
      ok: true,
      interest_paid: 100,
      principal_paid: 0,
      fees_paid: 0,
    })
    expect(allocateLoanPayment({ amount: 400, ...owed })).toEqual({
      ok: true,
      interest_paid: 250,
      principal_paid: 150,
      fees_paid: 0,
    })
  })

  it('a payment equal to principal alone does NOT retire the principal', () => {
    // The forgiven-interest hole: paying 1000 must leave $250 principal owed.
    const r = allocateLoanPayment({ amount: 1000, ...owed })
    expect(r).toEqual({
      ok: true,
      interest_paid: 250,
      principal_paid: 750,
      fees_paid: 0,
    })
  })

  it('full payoff clears both', () => {
    expect(allocateLoanPayment({ amount: 1250, ...owed })).toEqual({
      ok: true,
      interest_paid: 250,
      principal_paid: 1000,
      fees_paid: 0,
    })
  })

  it('fees come off the top, the rest goes interest-first', () => {
    expect(allocateLoanPayment({ amount: 300, fees: 20, ...owed })).toEqual({
      ok: true,
      interest_paid: 250,
      principal_paid: 30,
      fees_paid: 20,
    })
    // Payoff plus a fee is still a full payoff.
    expect(allocateLoanPayment({ amount: 1270, fees: 20, ...owed })).toEqual({
      ok: true,
      interest_paid: 250,
      principal_paid: 1000,
      fees_paid: 20,
    })
  })

  it('refuses more than is owed', () => {
    expect(allocateLoanPayment({ amount: 1250.01, ...owed })).toEqual({
      ok: false,
      reason: 'exceeds_payoff',
    })
  })

  it('refuses fees larger than the amount', () => {
    expect(allocateLoanPayment({ amount: 10, fees: 11, ...owed })).toEqual({
      ok: false,
      reason: 'fees_exceed_amount',
    })
  })

  it('tolerates sub-cent float drift at exact payoff', () => {
    const r = allocateLoanPayment({
      amount: 1008.3333,
      interestOutstanding: 8.3333,
      principalOutstanding: 1000,
    })
    expect(r).toEqual({
      ok: true,
      interest_paid: 8.3333,
      principal_paid: 1000,
      fees_paid: 0,
    })
  })
})

describe('planLoanPayment — paying and extending are one act', () => {
  // $1,000 at 25% a 30-day period: $250 a period. Issued Aug 21, due Sep 20.
  const loan = {
    principal: 1000,
    monthlyRate: 0.25,
    issueDate: '2026-08-21',
    dueDate: '2026-09-20',
    events: [] as Array<{ principal_paid: number; interest_paid: number; fees_paid: number }>,
    periodDays: 30,
  }

  it('one period of interest moves the due date one period from the OLD due date', () => {
    // 15 days late: the date still counts from Sep 20, not from today.
    const p = planLoanPayment({ ...loan, today: '2026-10-05', periods: 1, amount: 250 })
    expect(p).toMatchObject({
      ok: true,
      extension_cost: 250,
      interest_paid: 250,
      principal_paid: 0,
      new_due_date: '2026-10-20',
      closes: false,
    })
  })

  it('two periods cost two periods of interest and move the date two', () => {
    expect(extensionCost(loan, 2)).toBe(500)
    const p = planLoanPayment({ ...loan, today: '2026-10-25', periods: 2, amount: 500 })
    expect(p).toMatchObject({ ok: true, interest_paid: 500, principal_paid: 0, new_due_date: '2026-11-19' })
  })

  it('refuses to move the date on interest that was not paid', () => {
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 100 })).toEqual({
      ok: false,
      reason: 'extension_underpaid',
      needed: 250,
    })
  })

  it('a customer paying early still pays the whole period, and none of it becomes principal', () => {
    // Day 25 of 30: only $208.33 has accrued, but the period being paid is $250.
    const p = planLoanPayment({ ...loan, today: '2026-09-15', periods: 1, amount: 250 })
    expect(p).toMatchObject({ ok: true, interest_paid: 250, principal_paid: 0, new_due_date: '2026-10-20' })
  })

  it('money past the interest pays the loan down, and the date still moves', () => {
    const p = planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 450 })
    expect(p).toMatchObject({ ok: true, interest_paid: 250, principal_paid: 200, new_due_date: '2026-10-20', closes: false })
  })

  it('interest accrued to today is paid before any principal', () => {
    // 15 days late: $375 accrued. $400 with one period = $375 interest, $25 principal.
    const p = planLoanPayment({ ...loan, today: '2026-10-05', periods: 1, amount: 400 })
    expect(p).toMatchObject({ ok: true, interest_paid: 375, principal_paid: 25 })
  })

  it('with no periods it is a plain payment and the date stays', () => {
    const p = planLoanPayment({ ...loan, today: '2026-09-20', periods: 0, amount: 300 })
    expect(p).toMatchObject({ ok: true, periods: 0, extension_cost: 0, interest_paid: 250, principal_paid: 50, new_due_date: null })
  })

  it('interest already paid counts toward the next move', () => {
    const paid = { ...loan, events: [{ principal_paid: 0, interest_paid: 100, fees_paid: 0 }] }
    expect(extensionCost(paid, 1)).toBe(150)
    expect(planLoanPayment({ ...paid, today: '2026-09-20', periods: 1, amount: 150 })).toMatchObject({
      ok: true,
      interest_paid: 150,
      new_due_date: '2026-10-20',
    })
  })

  it('the second move costs one more period, not the first one again', () => {
    const renewed = { ...loan, dueDate: '2026-10-20', events: [{ principal_paid: 0, interest_paid: 250, fees_paid: 0 }] }
    expect(extensionCost(renewed, 1)).toBe(250)
    expect(planLoanPayment({ ...renewed, today: '2026-10-20', periods: 1, amount: 250 })).toMatchObject({
      ok: true,
      new_due_date: '2026-11-19',
    })
  })

  it('paying everything closes the loan and moves no date', () => {
    const p = planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 1250 })
    expect(p).toMatchObject({ ok: true, interest_paid: 250, principal_paid: 1000, closes: true, new_due_date: null })
  })

  it('refuses more than is owed, and fees larger than the payment', () => {
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 1300 })).toEqual({ ok: false, reason: 'exceeds_payoff' })
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 0, amount: 10, fees: 20 })).toEqual({ ok: false, reason: 'fees_exceed_amount' })
  })

  it('a fee comes off the top and does not count toward the interest', () => {
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 250, fees: 5 })).toMatchObject({
      ok: false,
      reason: 'extension_underpaid',
    })
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 255, fees: 5 })).toMatchObject({
      ok: true,
      fees_paid: 5,
      interest_paid: 250,
    })
  })

  it('a cost that is not whole cents is rounded to the cent the clerk collects', () => {
    // $133.33 at 25% is $33.3325 a period: the clerk collects $33.33.
    const odd = { ...loan, principal: 133.33 }
    const cost = extensionCost(odd, 1)
    expect(cost).toBe(33.33)
    expect(planLoanPayment({ ...odd, today: '2026-09-20', periods: 1, amount: cost })).toMatchObject({ ok: true, new_due_date: '2026-10-20' })
  })

  it('the minimum monthly charge sets the cost of a small loan', () => {
    const small = { ...loan, principal: 10, minMonthlyCharge: 5 }
    expect(extensionCost(small, 1)).toBe(5)
  })

  it('says how many periods bring a late loan current', () => {
    expect(periodsToBringCurrent('2026-09-20', '2026-09-10', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-09-20', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-10-05', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-10-20', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-10-21', 30)).toBe(2)
    expect(periodsToBringCurrent('2026-09-20', '2026-11-23', 30)).toBe(3)
  })
})
