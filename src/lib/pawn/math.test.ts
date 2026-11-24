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
  extensionCostToDate,
  dayInTimezone,
  daysBetween,
  interestAccrued,
  interestAccruedOnBalance,
  paydownsOf,
  payoffBalance,
  periodsToBringCurrent,
  planFreeTime,
  planLoanPayment,
  r4,
  splitPayment,
  toMoney,
  todayDateString,
  type ChargeModel,
} from './math'

const TZ = 'America/New_York'
/** A tenant with no jurisdiction: by the day from the first day. */
const DAY: ChargeModel = { fullPeriods: 0, periodDays: 30, timezone: TZ }
/** Florida, § 539.001(11)(c): two full 30-day periods, then by the day. */
const FL: ChargeModel = { fullPeriods: 2, periodDays: 30, timezone: TZ }
/** Noon in the shop on a calendar day: when a test's payment was taken. */
const at = (day: string) => `${day}T12:00:00-04:00`
/** For events that pay nothing toward the loan, the day does not matter. */
const AT = at('2026-01-01')

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
    expect(interestAccrued(0, 0.1, 30, 0, DAY)).toBe(0)
    expect(interestAccrued(100, 0.1, 0, 0, DAY)).toBe(0)
    expect(interestAccrued(100, 0.1, -5, 0, DAY)).toBe(0)
  })

  it('classic case: $1000 @ 10%/mo for 30 days → $100', () => {
    expect(interestAccrued(1000, 0.1, 30, 0, DAY)).toBeCloseTo(100, 4)
  })

  it('partial month pro-rates straight-line', () => {
    // $1000 @ 10%/mo for 15 days → $50.
    expect(interestAccrued(1000, 0.1, 15, 0, DAY)).toBeCloseTo(50, 4)
  })

  describe('min_monthly_charge floor (Session 12)', () => {
    it('floors a small principal at min/30 per day', () => {
      // $10 @ 10%/mo with $20 min:
      //   percentageDaily = 0.0333…
      //   minDaily        = 20/30 = 0.6667
      //   30 days → $20, 15 days → $10, 1 day → $0.6667.
      expect(interestAccrued(10, 0.1, 30, 20, DAY)).toBeCloseTo(20, 4)
      expect(interestAccrued(10, 0.1, 15, 20, DAY)).toBeCloseTo(10, 4)
      expect(interestAccrued(10, 0.1, 1, 20, DAY)).toBeCloseTo(0.6667, 4)
    })

    it('does NOT lower interest above the floor', () => {
      // $1000 @ 10%/mo with $20 min: percentage interest dominates.
      expect(interestAccrued(1000, 0.1, 30, 20, DAY)).toBeCloseTo(100, 4)
    })

    it('handles a zero rate with a min set (defensive)', () => {
      // Hypothetical: rate=0 + min=$15 → 30 days → $15.
      expect(interestAccrued(100, 0, 30, 15, DAY)).toBeCloseTo(15, 4)
      expect(interestAccrued(100, 0, 0, 15, DAY)).toBe(0)
    })

    it('treats min<=0 as no floor', () => {
      expect(interestAccrued(1000, 0.1, 30, 0, DAY)).toBeCloseTo(100, 4)
      expect(interestAccrued(1000, 0.1, 30, -5, DAY)).toBeCloseTo(100, 4)
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
      { principal_paid: 50, interest_paid: 10, fees_paid: 0, interest_waived: 0, occurred_at: AT },
      { principal_paid: 25, interest_paid: 5, fees_paid: 1, interest_waived: 0, occurred_at: AT },
    ])
    expect(out.principalApplied).toBe(75)
    expect(out.interestApplied).toBe(15)
    expect(out.feesApplied).toBe(1)
  })

  it('handles string-shaped Supabase NUMERIC values', () => {
    const out = appliedPayments([
      // @ts-expect-error — runtime allows string from DB; Pick<LoanEventRow>
      // narrows to the generated type which uses string for NUMERIC.
      { principal_paid: '50.0000', interest_paid: '10.0000', fees_paid: '0', interest_waived: 0, occurred_at: AT },
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
      charge: DAY,
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
      charge: DAY,
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
      charge: DAY,
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 0, interest_paid: 50, fees_paid: 0, interest_waived: 0, occurred_at: AT },
      ],
    })
    expect(r.interestApplied).toBe(50)
    expect(r.interestOutstanding).toBeCloseTo(50, 4)
    expect(r.payoff).toBeCloseTo(1050, 4)
  })

  it('partial principal payment reduces principalOutstanding', () => {
    const r = payoffBalance({
      charge: DAY,
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 200, interest_paid: 100, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-04-29') },
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
      charge: DAY,
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 0, interest_paid: 200, fees_paid: 0, interest_waived: 0, occurred_at: AT },
      ],
    })
    expect(r.interestOutstanding).toBe(0)
    expect(r.payoff).toBe(1000)
  })

  it('once principal is fully paid, outstanding interest does not bill', () => {
    const r = payoffBalance({
      charge: DAY,
      principal: 1000,
      monthlyRate: 0.1,
      issueDate: '2026-03-30',
      today: '2026-04-29',
      events: [
        { principal_paid: 1000, interest_paid: 0, fees_paid: 0, interest_waived: 0, occurred_at: AT },
      ],
    })
    expect(r.principalOutstanding).toBe(0)
    expect(r.payoff).toBe(0)
  })

  it('min_monthly_charge floor flows through payoff', () => {
    // $10 @ 10%/mo with $20 min, 30 days → $20 interest → $30 payoff.
    const r = payoffBalance({
      charge: DAY,
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
      charge: DAY,
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
    events: [] as Array<{ principal_paid: number; interest_paid: number; fees_paid: number; interest_waived: number; occurred_at: string }>,
    charge: FL,
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
    // Day 25 of 30: the period is owed in full from its first day.
    const p = planLoanPayment({ ...loan, today: '2026-09-15', periods: 1, amount: 250 })
    expect(p).toMatchObject({ ok: true, interest_paid: 250, principal_paid: 0, new_due_date: '2026-10-20' })
  })

  it('money past the interest pays the loan down, and the date still moves', () => {
    const p = planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 450 })
    expect(p).toMatchObject({ ok: true, interest_paid: 250, principal_paid: 200, new_due_date: '2026-10-20', closes: false })
  })

  it('interest accrued to today is paid before any principal', () => {
    // 15 days late is inside the second period: $500 accrued. $600 with one
    // period = $500 interest, $100 principal.
    const p = planLoanPayment({ ...loan, today: '2026-10-05', periods: 1, amount: 600 })
    expect(p).toMatchObject({ ok: true, interest_paid: 500, principal_paid: 100 })
  })

  it('with no periods it is a plain payment and the date stays', () => {
    const p = planLoanPayment({ ...loan, today: '2026-09-20', periods: 0, amount: 300 })
    expect(p).toMatchObject({ ok: true, periods: 0, extension_cost: 0, interest_paid: 250, principal_paid: 50, new_due_date: null })
  })

  it('interest already paid counts toward the next move', () => {
    const paid = { ...loan, events: [{ principal_paid: 0, interest_paid: 100, fees_paid: 0, interest_waived: 0, occurred_at: AT }] }
    expect(extensionCost(paid, 1)).toBe(150)
    expect(planLoanPayment({ ...paid, today: '2026-09-20', periods: 1, amount: 150 })).toMatchObject({
      ok: true,
      interest_paid: 150,
      new_due_date: '2026-10-20',
    })
  })

  it('the second move costs one more period, not the first one again', () => {
    const renewed = { ...loan, dueDate: '2026-10-20', events: [{ principal_paid: 0, interest_paid: 250, fees_paid: 0, interest_waived: 0, occurred_at: AT }] }
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

  it('a third period, past day 60, costs a period by the day — the same $250', () => {
    expect(extensionCost(loan, 3)).toBe(750)
  })

  it('charged by the day, a customer paying five days early prepays those days', () => {
    const byDay = { ...loan, charge: DAY }
    expect(extensionCost(byDay, 1)).toBe(250)
    expect(planLoanPayment({ ...byDay, today: '2026-09-15', periods: 1, amount: 250 })).toMatchObject({
      ok: true,
      interest_paid: 250,
      principal_paid: 0,
    })
  })

  it('says how many periods bring a late loan current', () => {
    expect(periodsToBringCurrent('2026-09-20', '2026-09-10', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-09-20', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-10-05', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-10-20', 30)).toBe(1)
    expect(periodsToBringCurrent('2026-09-20', '2026-10-21', 30)).toBe(2)
    expect(periodsToBringCurrent('2026-09-20', '2026-11-23', 30)).toBe(3)
    // A ticket two years late still reaches a date in the future.
    expect(periodsToBringCurrent('2024-11-23', '2026-11-23', 30)).toBe(25)
  })
})

describe('interestAccrued — full periods first (Florida, § 539.001(11)(c))', () => {
  it('one full period is owed from the day of the pawn through day 30', () => {
    // Ticket 15664: $300 at 10%, six days old. The old system and the paper
    // form say $330.00 to redeem; by the day it was $306.00.
    expect(interestAccrued(300, 0.1, 6, 0, FL)).toBe(30)
    expect(interestAccrued(300, 0.1, 0, 0, FL)).toBe(30)
    expect(interestAccrued(300, 0.1, 30, 0, FL)).toBe(30)
  })

  it('more than 30 days after the pawn: twice the period charge', () => {
    expect(interestAccrued(300, 0.1, 31, 0, FL)).toBe(60)
    expect(interestAccrued(300, 0.1, 60, 0, FL)).toBe(60)
    // The paper form's default-date figure: $400 at 10%, day 60 = $480.00.
    expect(400 + interestAccrued(400, 0.1, 60, 0, FL)).toBe(480)
  })

  it('after day 60 it accrues by the day at one-thirtieth of the period charge', () => {
    expect(interestAccrued(300, 0.1, 61, 0, FL)).toBe(61)
    expect(interestAccrued(300, 0.1, 90, 0, FL)).toBe(90)
    // Ticket 15634: $1,800 at 10%, 93 days = 2 x $180 + 33 x $6.
    expect(interestAccrued(1800, 0.1, 93, 0, FL)).toBe(558)
  })

  it('is never less than by the day, and exactly by the day from day 60 on', () => {
    for (let d = 0; d <= 200; d++) {
      const full = interestAccrued(1000, 0.25, d, 0, FL)
      const byDay = interestAccrued(1000, 0.25, d, 0, DAY)
      if (d >= 60) expect(full, `day ${d}`).toBeCloseTo(byDay, 4)
      else expect(full, `day ${d}`).toBeGreaterThanOrEqual(byDay)
    }
  })

  it('the $5 minimum is a charge per period, in full', () => {
    expect(interestAccrued(10, 0.25, 3, 5, FL)).toBe(5)
    expect(interestAccrued(10, 0.25, 31, 5, FL)).toBe(10)
    expect(interestAccrued(10, 0.25, 75, 5, FL)).toBe(12.5)
  })

  it('nothing before the day of the pawn, nothing on a loan with no principal', () => {
    expect(interestAccrued(300, 0.1, -1, 0, FL)).toBe(0)
    expect(interestAccrued(0, 0.1, 10, 5, FL)).toBe(0)
  })

  it('payoffBalance uses the model it is given', () => {
    const args = { principal: 300, monthlyRate: 0.1, issueDate: '2026-11-17', today: '2026-11-23', events: [] }
    expect(payoffBalance({ ...args, charge: FL }).payoff).toBe(330)
    expect(payoffBalance({ ...args, charge: DAY }).payoff).toBe(306)
  })
})

describe('extensionCost — a due date a few days past a period end', () => {
  // Ticket 15634 from the old system: $1,800 at 10%, issued Aug 22, due
  // Sep 22 — a calendar month, 31 days. The old system took $180.00 a month.
  const old = {
    principal: 1800,
    monthlyRate: 0.1,
    issueDate: '2026-08-22',
    dueDate: '2026-09-22',
    events: [] as Array<{ principal_paid: number; interest_paid: number; fees_paid: number; interest_waived: number; occurred_at: string }>,
    charge: FL,
  }

  it('one period moves a 31-day ticket for one period of interest, not two', () => {
    expect(extensionCost(old, 1)).toBe(180)
  })

  it('further out it is the interest through that date', () => {
    // Through day 61: two full periods + one day.
    expect(extensionCost(old, 2)).toBe(366)
    expect(extensionCost(old, 3)).toBe(546)
  })

  it('a 28-day February ticket still owes its whole first period', () => {
    expect(extensionCost({ ...old, issueDate: '2026-02-01', dueDate: '2026-03-01' }, 1)).toBe(180)
  })

  it('a due date deep inside the next period closes that period', () => {
    // Due on day 50: the second period is most of the way through.
    expect(extensionCost({ ...old, dueDate: '2026-10-11' }, 1)).toBe(360)
  })

  it('redeeming on day 31 still costs what day 31 costs', () => {
    expect(
      payoffBalance({ principal: 1800, monthlyRate: 0.1, issueDate: '2026-08-22', today: '2026-09-22', events: [], charge: FL })
        .interestOutstanding,
    ).toBe(360)
  })

  it('a ticket on the regular 30-day due date is unchanged', () => {
    const regular = { ...old, dueDate: '2026-09-21' }
    expect(extensionCost(regular, 1)).toBe(180)
    expect(extensionCost(regular, 2)).toBe(360)
    expect(extensionCost(regular, 3)).toBe(540)
  })
})

describe('free time — a manager forgives the interest and moves the date', () => {
  // $1,000 at 25% a 30-day period: $250 a period, $8.33 a day.
  const loan = {
    principal: 1000,
    monthlyRate: 0.25,
    issueDate: '2026-08-21',
    dueDate: '2026-09-20',
    events: [] as Array<{ principal_paid: number; interest_paid: number; fees_paid: number; interest_waived: number; occurred_at: string }>,
    charge: FL,
  }

  it('a free month moves the date one period and forgives one period\u2019s charge', () => {
    expect(planFreeTime(loan, 30)).toEqual({ days: 30, new_due_date: '2026-10-20', interest_waived: 250 })
  })

  it('free days forgive one-thirtieth of the period charge each, from the current due date', () => {
    expect(planFreeTime(loan, 5)).toEqual({ days: 5, new_due_date: '2026-09-25', interest_waived: 41.67 })
    expect(planFreeTime(loan, 1)).toEqual({ days: 1, new_due_date: '2026-09-21', interest_waived: 8.33 })
  })

  it('the minimum charge is what a small loan\u2019s free month is worth', () => {
    expect(planFreeTime({ ...loan, principal: 10, minMonthlyCharge: 5 }, 30)?.interest_waived).toBe(5)
  })

  it('refuses nothing, a fraction of a day, and more than a year', () => {
    expect(planFreeTime(loan, 0)).toBeNull()
    expect(planFreeTime(loan, -3)).toBeNull()
    expect(planFreeTime(loan, 367)).toBeNull()
    expect(planFreeTime(loan, 366)).not.toBeNull()
  })

  it('forgiven interest comes off what is owed — and is not interest collected', () => {
    // Day 60: two periods accrued ($500). One was paid, one was forgiven.
    const events = [
      { principal_paid: 0, interest_paid: 250, fees_paid: 0, interest_waived: 0, occurred_at: AT },
      { principal_paid: 0, interest_paid: 0, fees_paid: 0, interest_waived: 250, occurred_at: AT },
    ]
    const r = payoffBalance({ principal: 1000, monthlyRate: 0.25, issueDate: '2026-08-21', today: '2026-10-20', events, charge: FL })
    expect(r.interestAccrued).toBe(500)
    expect(r.interestApplied).toBe(250)
    expect(r.interestWaived).toBe(250)
    expect(r.interestOutstanding).toBe(0)
    expect(r.payoff).toBe(1000)
    expect(appliedPayments(events)).toMatchObject({ interestApplied: 250, interestWaived: 250 })
  })

  it('after a free month, the next month costs one month — not two', () => {
    // Free month given at the first due date: due moves to Oct 20, $250 forgiven.
    const given = {
      ...loan,
      dueDate: '2026-10-20',
      events: [{ principal_paid: 0, interest_paid: 0, fees_paid: 0, interest_waived: 250, occurred_at: AT }],
    }
    expect(extensionCost(given, 1)).toBe(250)
    expect(planLoanPayment({ ...given, today: '2026-10-20', periods: 1, amount: 250 })).toMatchObject({
      ok: true,
      interest_paid: 250,
      principal_paid: 0,
      new_due_date: '2026-11-19',
    })
  })

  it('a customer given free time who then redeems pays only what was not forgiven', () => {
    // Day 45, one free month given: $500 accrued, $250 forgiven.
    const events = [{ principal_paid: 0, interest_paid: 0, fees_paid: 0, interest_waived: 250, occurred_at: AT }]
    const r = payoffBalance({ principal: 1000, monthlyRate: 0.25, issueDate: '2026-08-21', today: '2026-10-05', events, charge: FL })
    expect(r.payoff).toBe(1250)
  })
})

describe('a payment toward the loan lowers the charges that come after it', () => {
  // § 539.001(11)(e): "any additional pawn service charges shall be
  // calculated on the remaining balance of the original amount financed".
  // $300 at 25% a 30-day period: $75 a period, $2.50 a day.
  const acc = (days: number, paydowns: Array<{ day: number; amount: number }>, charge = FL, min = 0) =>
    interestAccruedOnBalance(300, 0.25, days, min, charge, paydowns)

  it('with no payment it is the plain charge', () => {
    for (const d of [0, 1, 30, 31, 60, 61, 93, 400]) {
      expect(acc(d, [])).toBe(interestAccrued(300, 0.25, d, 0, FL))
      expect(acc(d, [], DAY)).toBe(interestAccrued(300, 0.25, d, 0, DAY))
    }
  })

  it('the period already owed does not change', () => {
    // $100 paid on day 10: the first period was owed in full at the counter.
    expect(acc(20, [{ day: 10, amount: 100 }])).toBe(75)
  })

  it('a payment on day 30 lowers the second period; one on day 31 is too late for it', () => {
    expect(acc(45, [{ day: 30, amount: 100 }])).toBe(125) // 75 + 25% of 200
    expect(acc(45, [{ day: 10, amount: 100 }])).toBe(125)
    expect(acc(45, [{ day: 31, amount: 100 }])).toBe(150) // period 2 already owed
  })

  it('by the day, the day of the payment is charged on the old balance', () => {
    // Day 70 payment: days 61-70 at $2.50, days 71-75 at $1.6667.
    expect(acc(75, [{ day: 70, amount: 100 }])).toBeCloseTo(150 + 25 + 8.3333, 4)
    // By the day from the first day: $1,000 at 10% is $3.3333 a day.
    expect(interestAccruedOnBalance(1000, 0.1, 20, 0, DAY, [{ day: 10, amount: 500 }])).toBeCloseTo(50, 4)
  })

  it('several payments, each from its own day', () => {
    const pays = [
      { day: 65, amount: 60 },
      { day: 65, amount: 40 },
      { day: 80, amount: 100 },
    ]
    // 150 + 5 days on 300 + 15 days on 200 + 10 days on 100.
    expect(acc(90, pays)).toBeCloseTo(150 + 5 * 2.5 + 15 * (50 / 30) + 10 * (25 / 30), 4)
  })

  it('the minimum charge still holds on a small balance — and nothing on none', () => {
    // $30 at 25% with a $5 minimum; $20 paid on day 30 leaves $10 (25% = $2.50).
    expect(interestAccruedOnBalance(30, 0.25, 45, 5, FL, [{ day: 30, amount: 20 }])).toBe(7.5 + 5)
    expect(interestAccruedOnBalance(30, 0.25, 45, 5, FL, [{ day: 30, amount: 30 }])).toBe(7.5)
  })

  it('a payment after the day asked about changes nothing', () => {
    expect(acc(45, [{ day: 50, amount: 100 }])).toBe(150)
  })
})

describe('the day a payment counts on is the shop\u2019s day', () => {
  it('9:30pm in the shop is still that day, though UTC is on the next', () => {
    expect(dayInTimezone('2026-09-20T01:30:00Z', 'America/New_York')).toBe('2026-09-19')
    expect(dayInTimezone('2026-09-20T12:00:00Z', 'America/New_York')).toBe('2026-09-20')
    expect(dayInTimezone('2026-09-20', 'America/New_York')).toBe('2026-09-20')
  })

  it('paydownsOf reads only payments toward the loan, in days after the pawn', () => {
    const events = [
      { principal_paid: 0, interest_paid: 75, fees_paid: 0, interest_waived: 0, occurred_at: '2026-09-20T15:00:00Z' },
      { principal_paid: 100, interest_paid: 0, fees_paid: 0, interest_waived: 0, occurred_at: '2026-09-21T01:30:00Z' },
      { principal_paid: 50, interest_paid: 0, fees_paid: 0, interest_waived: 0, occurred_at: '2026-08-25T15:00:00Z' },
    ]
    expect(paydownsOf(events, '2026-08-21', 'America/New_York')).toEqual([
      { day: 4, amount: 50 },
      { day: 30, amount: 100 }, // Sep 20, 9:30pm in the shop
    ])
  })
})

describe('payoff on the remaining balance', () => {
  it('ticket 15634: $1,800 at 10%, $100 paid toward it on day 70', () => {
    const events = [
      { principal_paid: 0, interest_paid: 0, fees_paid: 0, interest_waived: 0, occurred_at: '2026-08-22T15:00:00Z' },
      { principal_paid: 100, interest_paid: 0, fees_paid: 0, interest_waived: 0, occurred_at: '2026-10-31T17:10:00Z' },
    ]
    const r = payoffBalance({ principal: 1800, monthlyRate: 0.1, issueDate: '2026-08-22', today: '2026-11-23', events, charge: FL })
    // 180 + 180, ten days at $6.00, then 23 days at $5.6667 on $1,700.
    expect(r.interestAccrued).toBeCloseTo(360 + 60 + 23 * (170 / 30), 3)
    expect(r.payoff).toBeCloseTo(1700 + 550.3333, 3)
  })

  it('what is owed for a past day does not change when the customer pays later', () => {
    const before = { principal: 300, monthlyRate: 0.25, issueDate: '2026-08-21', today: '2026-10-05', charge: FL }
    const paid = [{ principal_paid: 100, interest_paid: 150, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-10-05') }]
    expect(payoffBalance({ ...before, events: [] }).interestAccrued).toBe(150)
    expect(payoffBalance({ ...before, events: paid }).interestAccrued).toBe(150)
  })
})

describe('a payment that pays ahead AND pays the loan down', () => {
  // $300 at 25%, pawned Aug 21, due Sep 20 (day 30): $75 a period.
  const loan = {
    principal: 300,
    monthlyRate: 0.25,
    issueDate: '2026-08-21',
    dueDate: '2026-09-20',
    events: [] as Array<{ principal_paid: number; interest_paid: number; fees_paid: number; interest_waived: number; occurred_at: string }>,
    charge: FL,
  }

  it('one period on the due date: nothing is paid ahead, the rest goes to the loan', () => {
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 1, amount: 175 })).toMatchObject({
      ok: true,
      extension_cost: 75,
      interest_paid: 75,
      principal_paid: 100,
      new_due_date: '2026-10-20',
    })
  })

  it('the period paid ahead is charged on what the payment leaves', () => {
    // Two periods on day 30 is $150 on the full $300. With $225: $100 goes
    // to the loan, and the second period is 25% of the $200 left = $50.
    expect(extensionCost(loan, 2)).toBe(150)
    const p = planLoanPayment({ ...loan, today: '2026-09-20', periods: 2, amount: 225 })
    expect(p).toMatchObject({
      ok: true,
      extension_cost: 125,
      interest_paid: 125,
      principal_paid: 100,
      new_due_date: '2026-11-19',
      closes: false,
    })
    // And that is what the loan then says was owed through the paid date.
    const after = [{ principal_paid: 100, interest_paid: 125, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-09-20') }]
    const r = payoffBalance({ principal: 300, monthlyRate: 0.25, issueDate: '2026-08-21', today: '2026-10-20', events: after, charge: FL })
    expect(r.interestAccrued).toBe(125)
    expect(r.interestOutstanding).toBe(0)
    expect(r.payoff).toBe(200)
  })

  it('exactly the listed interest pays ahead on the full balance', () => {
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 2, amount: 150 })).toMatchObject({
      ok: true,
      interest_paid: 150,
      principal_paid: 0,
    })
  })

  it('enough to pay everything closes the loan; more is refused', () => {
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 2, amount: 375 })).toMatchObject({
      ok: true,
      interest_paid: 75,
      principal_paid: 300,
      closes: true,
      new_due_date: null,
    })
    expect(planLoanPayment({ ...loan, today: '2026-09-20', periods: 2, amount: 380 })).toEqual({
      ok: false,
      reason: 'exceeds_payoff',
    })
  })

  it('by the day: the split lands on the cent', () => {
    // $1,000 at 25%, two periods ($500) paid on day 60, due moved to day 90.
    const late = {
      ...loan,
      principal: 1000,
      dueDate: '2026-11-19',
      events: [{ principal_paid: 0, interest_paid: 500, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-10-20') }],
    }
    // On day 90, two periods is $250 owed + 30 days ahead. With $700:
    // P + 250 + 25% of (1000 - P) = 700  ->  P = 266.67.
    const p = planLoanPayment({ ...late, today: '2026-11-19', periods: 2, amount: 700 })
    expect(p).toMatchObject({ ok: true, principal_paid: 266.67, interest_paid: 433.33, new_due_date: '2027-01-18' })
  })

  it('interest owed as of today is paid before the loan, even past the date paid to', () => {
    // Same loan, three days after its due date. One period costs $250 (the
    // interest through day 90), but $275 is owed as of today.
    const late = {
      ...loan,
      principal: 1000,
      dueDate: '2026-11-19',
      events: [{ principal_paid: 0, interest_paid: 500, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-10-20') }],
    }
    const p = planLoanPayment({ ...late, today: '2026-11-22', periods: 1, amount: 300 })
    expect(p).toMatchObject({ ok: true, extension_cost: 250, interest_paid: 275, principal_paid: 25 })
  })
})

describe('moving the due date to a day the clerk picks', () => {
  // $1,000 at 25%: two periods ($500) paid on day 60, due on day 90 (Nov 19).
  const loan = {
    principal: 1000,
    monthlyRate: 0.25,
    issueDate: '2026-08-21',
    dueDate: '2026-11-19',
    events: [{ principal_paid: 0, interest_paid: 500, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-10-20') }],
    charge: FL,
  }

  it('a full period away costs what one period costs', () => {
    expect(extensionCostToDate(loan, '2026-12-19')).toBe(extensionCost(loan, 1))
    expect(extensionCostToDate(loan, '2027-01-18')).toBe(extensionCost(loan, 2))
  })

  it('every day the date moves is a day of interest', () => {
    // Ten days: $8.3333 a day.
    expect(extensionCostToDate(loan, '2026-11-29')).toBe(83.33)
    expect(extensionCostToDate(loan, '2026-12-24')).toBe(291.67) // 35 days
  })

  it('the payment moves the date to that day when it covers the interest', () => {
    expect(planLoanPayment({ ...loan, today: '2026-11-19', periods: 0, newDueDate: '2026-11-29', amount: 83.33 })).toMatchObject({
      ok: true,
      periods: 0,
      move_days: 10,
      extension_cost: 83.33,
      interest_paid: 83.33,
      principal_paid: 0,
      new_due_date: '2026-11-29',
    })
    expect(planLoanPayment({ ...loan, today: '2026-11-19', periods: 0, newDueDate: '2026-11-29', amount: 50 })).toEqual({
      ok: false,
      reason: 'extension_underpaid',
      needed: 83.33,
    })
  })

  it('the date wins over a number of periods sent with it', () => {
    const p = planLoanPayment({ ...loan, today: '2026-11-19', periods: 3, newDueDate: '2026-11-29', amount: 83.33 })
    expect(p).toMatchObject({ ok: true, periods: 0, new_due_date: '2026-11-29' })
  })

  it('refuses a date that is not after the due date, not a date, or too far', () => {
    for (const bad of ['2026-11-19', '2026-11-01', 'tomorrow', '', '2040-01-01']) {
      expect(planLoanPayment({ ...loan, today: '2026-11-19', periods: 0, newDueDate: bad, amount: 500 })).toEqual({
        ok: false,
        reason: 'bad_due_date',
      })
    }
  })

  it('inside the full periods a short move still costs the whole period', () => {
    const fresh = { ...loan, dueDate: '2026-09-20', events: [] }
    expect(extensionCostToDate(fresh, '2026-09-30')).toBe(250)
  })
})

describe('free time on a loan that was paid down', () => {
  it('forgives the charge on what is still owed', () => {
    const loan = {
      principal: 1000,
      monthlyRate: 0.25,
      dueDate: '2026-11-19',
      events: [{ principal_paid: 400, interest_paid: 500, fees_paid: 0, interest_waived: 0, occurred_at: at('2026-10-20') }],
      charge: FL,
    }
    expect(planFreeTime(loan, 30)).toEqual({ days: 30, new_due_date: '2026-12-19', interest_waived: 150 })
    expect(planFreeTime(loan, 10)).toEqual({ days: 10, new_due_date: '2026-11-29', interest_waived: 50 })
  })
})
