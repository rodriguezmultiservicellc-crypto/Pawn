/**
 * Pure pawn-loan math. Decimal-safe within JS Number precision: every
 * intermediate result is rounded to 4 decimal places before further use,
 * matching the `numeric(18,4)` storage shape we use for money columns.
 *
 * IMPORTANT: never reach for these helpers on the wire (no float -> column).
 * They return Number for in-app math; persistence layers should pass the
 * result through `.toFixed(4)` (or rely on Postgres to coerce numeric).
 *
 * Convention: rates are decimal fractions, not percentages.
 *   monthlyRate = 0.10 means 10%/month.
 *   dailyRate   = monthlyRate / 30 (straight-line accrual, FL-friendly).
 *
 * Date math is done at UTC midnight to avoid timezone drift between server
 * and client. All issue_date / due_date columns are DATE (no time portion);
 * we treat them as UTC midnight at the day boundary.
 */

import type {
  LoanEventRow,
  LoanRow,
  PaymentMethod,
} from '@/types/database-aliases'

// ── 4-dp rounding ──────────────────────────────────────────────────────────

const SCALE = 10000

/** Round to 4 decimal places (banker / half-away-from-zero). */
export function r4(n: number): number {
  if (!isFinite(n)) return 0
  return Math.round(n * SCALE) / SCALE
}

/** Coerce a string|number|null|undefined money value to a Number rounded to
 *  4dp. Null/undefined -> 0. Strings come from Supabase numeric columns. */
export function toMoney(v: string | number | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return r4(n)
}

// ── Rate / accrual helpers ─────────────────────────────────────────────────

/** Convert monthly rate to daily rate (straight-line, 30-day month). */
export function dailyRateFromMonthly(monthlyRate: number): number {
  return r4(monthlyRate / 30)
}

/**
 * Straight-line accrual: principal × monthlyRate / 30 × daysElapsed.
 *
 * Optional `minMonthlyCharge` floors the daily accrual at
 * `minMonthlyCharge / 30`, so a 30-day redemption pays at least the
 * monthly minimum and a 15-day redemption pays half. Floor applies
 * regardless of monthlyRate — a $0 rate with $20 min still accrues
 * $20/mo (defensive; the form won't allow rate=0 today, but the math
 * shouldn't silently drop the minimum if it ever does).
 */
export function interestAccrued(
  principal: number,
  monthlyRate: number,
  daysElapsed: number,
  minMonthlyCharge: number = 0,
): number {
  if (daysElapsed <= 0 || principal <= 0) return 0
  const percentageDaily =
    monthlyRate > 0 ? (principal * monthlyRate) / 30 : 0
  const minDaily = minMonthlyCharge > 0 ? minMonthlyCharge / 30 : 0
  const daily = Math.max(percentageDaily, minDaily)
  if (daily <= 0) return 0
  return r4(daily * daysElapsed)
}

// ── Date helpers ───────────────────────────────────────────────────────────

/**
 * Calendar-day diff between two dates at UTC midnight. Accepts ISO date
 * strings ('YYYY-MM-DD') or Date instances. Negative when `b` precedes `a`.
 */
export function daysBetween(
  a: string | Date,
  b: string | Date,
): number {
  const da = toUtcMidnight(a)
  const db = toUtcMidnight(b)
  return Math.round((db - da) / 86400000)
}

function toUtcMidnight(d: string | Date): number {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
    if (m) {
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    }
    const parsed = Date.parse(d)
    if (!isFinite(parsed)) return 0
    const dt = new Date(parsed)
    return Date.UTC(
      dt.getUTCFullYear(),
      dt.getUTCMonth(),
      dt.getUTCDate(),
    )
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Today as a 'YYYY-MM-DD' UTC string. */
export function todayDateString(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Add `days` to a 'YYYY-MM-DD' string and return the same shape. */
export function addDaysIso(date: string, days: number): string {
  const ms = toUtcMidnight(date) + days * 86400000
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── Event aggregation ──────────────────────────────────────────────────────

export type AppliedTotals = {
  principalApplied: number
  interestApplied: number
  feesApplied: number
}

/**
 * Sum principal_paid / interest_paid / fees_paid across the events of a
 * single loan. Only events that actually carry split values contribute
 * (i.e. we ignore the 'issued' / 'extension' (no cash) / 'forfeiture' /
 * 'void' rows whose splits are all zero anyway).
 */
export function appliedPayments(
  events: ReadonlyArray<
    Pick<LoanEventRow, 'principal_paid' | 'interest_paid' | 'fees_paid'>
  >,
): AppliedTotals {
  let principalApplied = 0
  let interestApplied = 0
  let feesApplied = 0
  for (const e of events) {
    principalApplied += toMoney(e.principal_paid)
    interestApplied += toMoney(e.interest_paid)
    feesApplied += toMoney(e.fees_paid)
  }
  return {
    principalApplied: r4(principalApplied),
    interestApplied: r4(interestApplied),
    feesApplied: r4(feesApplied),
  }
}

// ── Payoff balance ─────────────────────────────────────────────────────────

export type PayoffArgs = {
  principal: number
  monthlyRate: number
  /** Date the loan was issued (the date interest starts accruing). */
  issueDate: string | Date
  /** Date to compute the payoff for. Defaults to today (UTC). */
  today?: string | Date
  events: ReadonlyArray<
    Pick<LoanEventRow, 'principal_paid' | 'interest_paid' | 'fees_paid'>
  >
  /** Optional snapshot of the rate's min_monthly_charge floor. */
  minMonthlyCharge?: number | null
}

export type PayoffResult = {
  /** Original principal disbursed at issue. */
  principal: number
  /** Principal that has been paid off via prior payments. */
  principalApplied: number
  /** Outstanding principal remaining (= principal − principalApplied). */
  principalOutstanding: number
  /** Interest accrued from issueDate to `today` on the original principal. */
  interestAccrued: number
  /** Interest already collected via prior payments. */
  interestApplied: number
  /** Outstanding interest remaining (= max(0, accrued − applied)). */
  interestOutstanding: number
  /** Total payoff today (principalOutstanding + interestOutstanding). */
  payoff: number
}

/**
 * Compute the payoff balance for a loan as of `today`.
 *
 * Convention:
 *   - Interest accrues straight-line on the ORIGINAL principal from the
 *     issue date forward. Partial principal payments do NOT reduce the
 *     accrual base mid-stream — that simplification matches how most pawn
 *     shops bill (and how FL-style fixed-fee tickets are written). When we
 *     ship per-extension rate changes, this helper will need a `from` /
 *     `to` segment array.
 *   - Interest paid is netted against accrued; any negative result is
 *     clamped to 0 (overpayment of interest is treated as fees).
 *   - Payoff floor is 0 — once principal is paid down to zero we don't
 *     accrue further interest in this calc (the redemption event freezes
 *     it on the DB side).
 */
export function payoffBalance(args: PayoffArgs): PayoffResult {
  const principal = r4(args.principal)
  const today = args.today ?? todayDateString()
  const days = Math.max(0, daysBetween(args.issueDate, today))

  const minCharge =
    args.minMonthlyCharge != null ? toMoney(args.minMonthlyCharge) : 0
  const accrued = interestAccrued(
    principal,
    args.monthlyRate,
    days,
    minCharge,
  )

  const { principalApplied, interestApplied } = appliedPayments(args.events)
  const principalOutstanding = r4(Math.max(0, principal - principalApplied))
  const interestOutstanding = r4(Math.max(0, accrued - interestApplied))

  // If principal is fully paid off, no further outstanding interest matters
  // for payoff purposes (redemption already happened or the next payment
  // closes it out).
  const effectiveInterest = principalOutstanding === 0 ? 0 : interestOutstanding

  const payoff = r4(principalOutstanding + effectiveInterest)

  return {
    principal,
    principalApplied,
    principalOutstanding,
    interestAccrued: accrued,
    interestApplied,
    interestOutstanding: effectiveInterest,
    payoff,
  }
}

// ── Payment splitting (interest-first) ─────────────────────────────────────

export type PaymentSplit = {
  interest_paid: number
  principal_paid: number
}

/**
 * Split a customer payment, applying it to OUTSTANDING INTEREST FIRST and
 * the remainder to principal. Caller is responsible for fees (separate).
 *
 * @param amount  - the cash collected from the customer this event.
 * @param accruedInterestOutstanding - interest currently owed.
 */
export function splitPayment(
  amount: number,
  accruedInterestOutstanding: number,
): PaymentSplit {
  const a = r4(amount)
  const owedInterest = r4(Math.max(0, accruedInterestOutstanding))
  if (a <= 0) return { interest_paid: 0, principal_paid: 0 }
  if (a <= owedInterest) {
    return { interest_paid: a, principal_paid: 0 }
  }
  return {
    interest_paid: owedInterest,
    principal_paid: r4(a - owedInterest),
  }
}

// ── Convenience: derive payoff from a LoanRow + events ─────────────────────

/**
 * Adapter that pulls fields off a Supabase-shaped LoanRow and computes the
 * payoff balance. Useful in server components and the detail page.
 */
export function payoffFromLoan(
  loan: Pick<
    LoanRow,
    | 'principal'
    | 'interest_rate_monthly'
    | 'issue_date'
    | 'min_monthly_charge'
  >,
  events: ReadonlyArray<
    Pick<LoanEventRow, 'principal_paid' | 'interest_paid' | 'fees_paid'>
  >,
  today?: string | Date,
): PayoffResult {
  return payoffBalance({
    principal: toMoney(loan.principal),
    monthlyRate: toMoney(loan.interest_rate_monthly),
    issueDate: loan.issue_date,
    today,
    events,
    minMonthlyCharge: loan.min_monthly_charge ?? null,
  })
}

// Re-export the payment method tuple so consumer files can import a single
// canonical list without duplicating it across UI dropdowns.
export const PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  'cash',
  'card',
  'check',
  'other',
]
