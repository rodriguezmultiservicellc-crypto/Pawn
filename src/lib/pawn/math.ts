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
 *   monthlyRate = 0.10 means 10% of the amount financed per PERIOD.
 *
 * How the charge builds up over time is the tenant's ChargeModel (from its
 * jurisdiction, never a constant here): the first `fullPeriods` periods are
 * owed in full the moment each starts, and after them the charge runs by the
 * day at 1/periodDays of a period's charge. Florida is 2 full periods of 30
 * days (§ 539.001(11)(c)). Every payoff surface passes the model — it is a
 * required argument so none can fall back to another rule by accident.
 *
 * A payment toward the loan lowers what LATER charges are figured on
 * (§ 539.001(11)(e): "any additional pawn service charges shall be
 * calculated on the remaining balance of the original amount financed").
 * Charges already owed when the payment was made do not change. That is why
 * every loan event handed to a payoff carries its date (LoanMoneyEvent).
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

/** The period the monthly rate is quoted for. */
export const RATE_PERIOD_DAYS = 30

/**
 * How a pawn service charge accrues. Comes from the tenant's jurisdiction
 * (`chargeModelOf` in lib/jurisdictions/rules) — never built from constants.
 */
export type ChargeModel = {
  /**
   * Periods, counted from the date of the pawn, charged in full once the
   * period starts. 0 = by the day from the first day.
   */
  fullPeriods: number
  /** Days in one period. */
  periodDays: number
  /**
   * The shop's IANA timezone: the calendar a payment's day is read on. A
   * payment toward the loan taken at 9pm counts on the shop's day, not on
   * UTC's next one.
   */
  timezone: string
}

/** A payment toward the loan, `day` days after the date of the pawn. */
export type Paydown = { day: number; amount: number }

/** One period's charge on a balance: the rate, never less than the minimum. */
function periodChargeOn(
  balance: number,
  monthlyRate: number,
  minMonthlyCharge: number,
): number {
  if (balance <= 0) return 0
  return Math.max(
    monthlyRate > 0 ? balance * monthlyRate : 0,
    minMonthlyCharge > 0 ? minMonthlyCharge : 0,
  )
}

/**
 * The service charge accrued `daysElapsed` days after the date of the pawn,
 * on a loan the customer may have paid down along the way.
 *
 * One period's charge is balance × monthlyRate, never less than
 * `minMonthlyCharge` (the per-period minimum; it applies whatever the rate —
 * a $0 rate with a $5 minimum still charges $5 a period).
 *
 * With `fullPeriods` = 2 and 30-day periods (Florida):
 *   day 0-30   one period's charge — redeeming early refunds nothing
 *   day 31-60  two periods' charge
 *   day 61+    two periods' charge + 1/30 of a period's charge per day
 * With `fullPeriods` = 0 it is 1/periodDays of a period's charge per day
 * from the first day, and nothing on the day of the pawn.
 *
 * The balance each charge is figured on is what was still owed when that
 * charge started:
 *   - a period charged in full is owed from its first day, so it is figured
 *     on the balance left by the payments made BEFORE that day (a payment on
 *     day 30 lowers the second period; one on day 31 does not — the second
 *     period was already owed);
 *   - a day charged by the day is figured on the balance left by the
 *     payments made before that day (the day of a payment is charged on the
 *     balance the customer walked in with).
 *
 * Before the date of the pawn, and on a loan with no principal, it is 0.
 */
export function interestAccruedOnBalance(
  principal: number,
  monthlyRate: number,
  daysElapsed: number,
  minMonthlyCharge: number,
  charge: ChargeModel,
  paydowns: ReadonlyArray<Paydown>,
): number {
  if (daysElapsed < 0 || principal <= 0) return 0
  const periodDays = charge.periodDays > 0 ? charge.periodDays : RATE_PERIOD_DAYS
  const fullPeriods = Math.max(0, Math.floor(charge.fullPeriods))
  // What is still owed once the payments made on or before `day` are in.
  const balanceAfter = (day: number): number => {
    let balance = principal
    for (const p of paydowns) if (p.day <= day) balance -= p.amount
    return Math.max(0, balance)
  }
  const on = (balance: number) =>
    periodChargeOn(balance, monthlyRate, minMonthlyCharge)

  let total = 0
  // A period is owed from its first day: day 0 is already inside period 1.
  const started = Math.floor(Math.max(0, daysElapsed - 1) / periodDays) + 1
  const inFull = Math.min(started, fullPeriods)
  for (let k = 1; k <= inFull; k++) {
    // Period 1 is owed at the counter, before any payment can exist.
    total += on(k === 1 ? principal : balanceAfter((k - 1) * periodDays))
  }
  // After the full periods, by the day: days (from, daysElapsed], cut at
  // every payment toward the loan.
  let from = fullPeriods * periodDays
  if (daysElapsed > from) {
    const first = from
    const cuts = paydowns
      .map((p) => p.day)
      .filter((d) => d > first && d < daysElapsed)
      .sort((a, b) => a - b)
    for (const cut of cuts) {
      if (cut === from) continue
      total += (on(balanceAfter(from)) / periodDays) * (cut - from)
      from = cut
    }
    total += (on(balanceAfter(from)) / periodDays) * (daysElapsed - from)
  }
  return r4(total)
}

/**
 * The service charge accrued on a loan nobody has paid down — the figure a
 * ticket discloses the day it is written. A payoff never calls this: it
 * goes through payoffBalance, which reads the payments.
 */
export function interestAccrued(
  principal: number,
  monthlyRate: number,
  daysElapsed: number,
  minMonthlyCharge: number,
  charge: ChargeModel,
): number {
  return interestAccruedOnBalance(
    principal,
    monthlyRate,
    daysElapsed,
    minMonthlyCharge,
    charge,
    [],
  )
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

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * The calendar day ('YYYY-MM-DD') an instant falls on in an IANA timezone.
 * A bare 'YYYY-MM-DD' is already a day and comes back as is.
 */
export function dayInTimezone(instant: string | Date, timezone: string): string {
  if (typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instant)) {
    return instant
  }
  const at = typeof instant === 'string' ? new Date(instant) : instant
  if (!isFinite(at.getTime())) {
    return typeof instant === 'string' ? instant.slice(0, 10) : ''
  }
  try {
    let f = dayFormatters.get(timezone)
    if (!f) {
      // en-CA formats as YYYY-MM-DD.
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      dayFormatters.set(timezone, f)
    }
    return f.format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
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

/**
 * The columns of a loan event that a payoff reads. `interest_waived` and
 * `occurred_at` are REQUIRED on purpose: a screen that leaves the first out
 * of its query would charge a customer interest a manager forgave, and one
 * that leaves out the second would keep charging on money the customer
 * already paid back. The type check stops both at build time.
 */
export type LoanMoneyEvent = Pick<
  LoanEventRow,
  | 'principal_paid'
  | 'interest_paid'
  | 'fees_paid'
  | 'interest_waived'
  | 'occurred_at'
>

/**
 * The payments toward the loan among its events, each on the shop's day it
 * was taken, as days after the date of the pawn.
 */
export function paydownsOf(
  events: ReadonlyArray<LoanMoneyEvent>,
  issueDate: string | Date,
  timezone: string,
): Paydown[] {
  const out: Paydown[] = []
  for (const e of events) {
    const amount = toMoney(e.principal_paid)
    if (amount <= 0) continue
    out.push({
      day: Math.max(
        0,
        daysBetween(issueDate, dayInTimezone(e.occurred_at, timezone)),
      ),
      amount,
    })
  }
  return out.sort((a, b) => a.day - b.day)
}

export type AppliedTotals = {
  principalApplied: number
  interestApplied: number
  /** Interest forgiven (a manager's free time). Not income. */
  interestWaived: number
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
    LoanMoneyEvent
  >,
): AppliedTotals {
  let principalApplied = 0
  let interestApplied = 0
  let interestWaived = 0
  let feesApplied = 0
  for (const e of events) {
    principalApplied += toMoney(e.principal_paid)
    interestApplied += toMoney(e.interest_paid)
    interestWaived += toMoney(e.interest_waived)
    feesApplied += toMoney(e.fees_paid)
  }
  return {
    principalApplied: r4(principalApplied),
    interestApplied: r4(interestApplied),
    interestWaived: r4(interestWaived),
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
    LoanMoneyEvent
  >
  /** Optional snapshot of the rate's min_monthly_charge floor. */
  minMonthlyCharge?: number | null
  /** How the charge accrues (the tenant's jurisdiction). */
  charge: ChargeModel
}

export type PayoffResult = {
  /** Original principal disbursed at issue. */
  principal: number
  /** Principal that has been paid off via prior payments. */
  principalApplied: number
  /** Outstanding principal remaining (= principal − principalApplied). */
  principalOutstanding: number
  /** Charge accrued from issueDate to `today`, each part of it on the
   *  balance that was still owed when it started. */
  interestAccrued: number
  /** Interest already collected via prior payments. */
  interestApplied: number
  /** Interest forgiven by a manager's free time. */
  interestWaived: number
  /** Outstanding interest remaining (= max(0, accrued − applied − waived)). */
  interestOutstanding: number
  /** Total payoff today (principalOutstanding + interestOutstanding). */
  payoff: number
}

/**
 * Compute the payoff balance for a loan as of `today`.
 *
 * Convention:
 *   - The charge accrues from the issue date forward the way the tenant's
 *     ChargeModel says, and a payment toward the loan lowers the balance
 *     the LATER charges are figured on (interestAccruedOnBalance).
 *   - Interest paid is netted against accrued; any negative result is
 *     clamped to 0 (overpayment of interest is treated as fees).
 *   - Payoff floor is 0 — once principal is paid down to zero we don't
 *     accrue further interest in this calc (the redemption event freezes
 *     it on the DB side).
 */
export function payoffBalance(args: PayoffArgs): PayoffResult {
  const principal = r4(args.principal)
  const today = args.today ?? todayDateString()

  const minCharge =
    args.minMonthlyCharge != null ? toMoney(args.minMonthlyCharge) : 0
  // Not clamped at 0: before the date of the pawn nothing has accrued.
  const accrued = interestAccruedOnBalance(
    principal,
    args.monthlyRate,
    daysBetween(args.issueDate, today),
    minCharge,
    args.charge,
    paydownsOf(args.events, args.issueDate, args.charge.timezone),
  )

  const { principalApplied, interestApplied, interestWaived } = appliedPayments(args.events)
  const principalOutstanding = r4(Math.max(0, principal - principalApplied))
  const interestOutstanding = r4(Math.max(0, accrued - interestApplied - interestWaived))

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
    interestWaived,
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

// ── Payment allocation (server-authoritative) ──────────────────────────────

export type PaymentAllocation =
  | {
      ok: true
      interest_paid: number
      principal_paid: number
      fees_paid: number
    }
  | { ok: false; reason: 'fees_exceed_amount' | 'exceeds_payoff' }

/**
 * Decide how a loan payment is booked. This is the ONLY place the
 * interest / principal split is determined — the server action calls it
 * with the payoff it just computed and ignores any split the browser sent.
 *
 *   amount = fees + interest + principal
 *
 * Fees (lost-ticket fee, etc.) come off the top as entered. The rest goes to
 * OUTSTANDING INTEREST FIRST, then principal. Principal can never be paid
 * down while interest is still owed, so a loan cannot reach "principal
 * fully paid" (and flip to redeemed) with interest forgiven. A payment
 * larger than what is owed is refused rather than silently absorbed.
 */
export function allocateLoanPayment(args: {
  amount: number
  fees?: number | null
  interestOutstanding: number
  principalOutstanding: number
}): PaymentAllocation {
  const amount = r4(args.amount)
  const fees = r4(Math.max(0, toMoney(args.fees ?? 0)))
  if (fees > amount + 0.0001) return { ok: false, reason: 'fees_exceed_amount' }

  const toLoan = r4(Math.max(0, amount - fees))
  const split = splitPayment(toLoan, args.interestOutstanding)
  const principalOwed = r4(Math.max(0, args.principalOutstanding))
  if (split.principal_paid > principalOwed + 0.0001) {
    return { ok: false, reason: 'exceeds_payoff' }
  }
  return {
    ok: true,
    interest_paid: split.interest_paid,
    principal_paid: Math.min(split.principal_paid, principalOwed),
    fees_paid: fees,
  }
}

// ── Payment that may move the due date ─────────────────────────────────────

/**
 * Most periods one payment may move the due date. A sanity bound, not a
 * rule: a ticket a year late has to be able to reach a date in the future.
 */
export const MAX_EXTENSION_PERIODS = 120

/** Whole cents, the unit money changes hands in. */
function cents(n: number): number {
  return Math.round(n * 100 + 1e-7) / 100
}

type PlanLoan = {
  principal: number
  monthlyRate: number
  minMonthlyCharge?: number | null
  issueDate: string
  /** The loan's CURRENT due date — the date a move is counted from. */
  dueDate: string
  events: ReadonlyArray<
    LoanMoneyEvent
  >
  /** How the charge accrues; its periodDays is one move of the due date. */
  charge: ChargeModel
}

/**
 * What it costs, in interest, to move the due date `periods` periods.
 *
 * The due date is the day the interest of the period ending there is owed.
 * Paying that period's interest moves the date one period — from the OLD due
 * date, never from the day the customer walked in, so coming in late does
 * not buy free days. Two periods cost the interest through the old due date
 * plus one more period, and so on.
 *
 * Interest already paid counts, so a customer who paid part of it earlier
 * only owes the rest. Returned in whole cents.
 *
 * A due date is the END of a period. Where periods are charged in full, a
 * due date that falls a few days past a period's end — a ticket from the old
 * system due a calendar month (31 days) out, or one a manager moved a few
 * days — still closes THAT period, not the next: paying one period's charge
 * moves it. (The payoff is untouched: redeeming on day 31 costs what the
 * jurisdiction says day 31 costs.)
 *
 * Periods still ahead are figured on the balance the loan has NOW. A payment
 * that also pays the loan down is planned by planLoanPayment, which figures
 * them on what that payment leaves.
 */
export function extensionCost(loan: PlanLoan, periods: number): number {
  const n = Math.floor(periods)
  if (!(n > 0)) return 0
  return moveCost(loan, n * periodDaysOf(loan.charge), null)
}

/**
 * What it costs, in interest, to move the due date to `newDueDate` — any
 * later day, not only a whole number of periods.
 *
 * Same rule as extensionCost, counted in days: a due date is paid up to one
 * period before it, so every day the date moves is a day of interest paid.
 * Moving it a full period costs the period ending at the old due date;
 * moving it ten days costs the first ten days of that period.
 */
export function extensionCostToDate(loan: PlanLoan, newDueDate: string): number {
  return moveCost(loan, daysBetween(loan.dueDate, newDueDate), null)
}

function periodDaysOf(charge: ChargeModel): number {
  return charge.periodDays > 0 ? charge.periodDays : RATE_PERIOD_DAYS
}

/**
 * The interest it takes to move the due date `moveDays` days, as if
 * `paydown` were also paid toward the loan (on its `day`): what starts after
 * it costs less.
 */
function moveCost(
  loan: PlanLoan,
  moveDays: number,
  paydown: Paydown | null,
): number {
  const move = Math.floor(moveDays)
  if (!(move > 0)) return 0
  const periodDays = periodDaysOf(loan.charge)
  const paidThrough = addDaysIso(loan.dueDate, move - periodDays)
  let days = daysBetween(loan.issueDate, paidThrough)
  const fullDays = Math.max(0, Math.floor(loan.charge.fullPeriods)) * periodDays
  if (days > 0 && days < fullDays) {
    // Inside the full periods: the period this date closes, counted to the
    // nearest period end.
    days = Math.max(1, Math.round(days / periodDays)) * periodDays
  }
  const paydowns = paydownsOf(loan.events, loan.issueDate, loan.charge.timezone)
  if (paydown && paydown.amount > 0) paydowns.push(paydown)
  const accrued = interestAccruedOnBalance(
    r4(loan.principal),
    loan.monthlyRate,
    days,
    loan.minMonthlyCharge != null ? toMoney(loan.minMonthlyCharge) : 0,
    loan.charge,
    paydowns,
  )
  const { interestApplied, interestWaived } = appliedPayments(loan.events)
  return cents(Math.max(0, accrued - interestApplied - interestWaived))
}

// ── Free time (a manager's gift) ───────────────────────────────────────────

/** Most days one gift of free time may cover. A sanity bound, not a rule. */
export const MAX_FREE_DAYS = 366

/**
 * A manager gives a customer `days` of free time: the due date moves that
 * many days — from the CURRENT due date — and the charge for those days is
 * forgiven. One day is worth 1/periodDays of a period's charge, so a free
 * period forgives exactly one period's charge. In whole cents.
 *
 * The charge is the one on what the customer still owes: a loan that was
 * paid down is charged on the remaining balance, so that is all there is to
 * forgive.
 *
 * The forgiven amount is a credit against the accrued charge
 * (loan_events.interest_waived), never a payment: nothing is collected and
 * nothing counts as income.
 */
export function planFreeTime(
  loan: Pick<
    PlanLoan,
    'principal' | 'monthlyRate' | 'minMonthlyCharge' | 'dueDate' | 'charge' | 'events'
  >,
  days: number,
): { days: number; new_due_date: string; interest_waived: number } | null {
  const n = Math.floor(days)
  if (!(n > 0) || n > MAX_FREE_DAYS) return null
  const periodDays = loan.charge.periodDays > 0 ? loan.charge.periodDays : RATE_PERIOD_DAYS
  const balance = r4(
    Math.max(0, r4(loan.principal) - appliedPayments(loan.events).principalApplied),
  )
  const minCharge = loan.minMonthlyCharge != null ? toMoney(loan.minMonthlyCharge) : 0
  const periodCharge = periodChargeOn(balance, loan.monthlyRate, minCharge)
  return {
    days: n,
    new_due_date: addDaysIso(loan.dueDate, n),
    interest_waived: cents((periodCharge / periodDays) * n),
  }
}

/** Fewest periods that leave the loan not past due on `today` (at least 1). */
export function periodsToBringCurrent(
  dueDate: string,
  today: string,
  periodDays: number,
): number {
  const late = daysBetween(dueDate, today)
  if (late <= 0 || periodDays <= 0) return 1
  return Math.min(MAX_EXTENSION_PERIODS, Math.ceil(late / periodDays))
}

export type LoanPaymentPlan =
  | {
      ok: true
      /** Periods the due date moves (0 = it stays, or it moves to a date). */
      periods: number
      /** Days the due date moves, whichever way it was asked for. */
      move_days: number
      /** Interest it takes to move the date that far. */
      extension_cost: number
      interest_paid: number
      principal_paid: number
      fees_paid: number
      /** Null when the date does not move (or the payment closes the loan). */
      new_due_date: string | null
      /** The payment pays everything owed: the loan is redeemed. */
      closes: boolean
    }
  | {
      ok: false
      reason:
        | 'fees_exceed_amount'
        | 'exceeds_payoff'
        | 'extension_underpaid'
        /** The date asked for is not after the current due date, or too far. */
        | 'bad_due_date'
      /** For 'extension_underpaid': the interest the move takes. */
      needed?: number
    }

/**
 * Decide how ONE loan payment is booked and whether it moves the due date.
 * Paying and extending are the same act at the counter, so they are one
 * calculation: the server action and the dialog's preview both call this,
 * and the server ignores any split or date the browser sent.
 *
 *   amount = fees + interest + principal
 *
 * - Fees come off the top as entered.
 * - `periods` > 0 moves the due date that many periods from the CURRENT due
 *   date. It is refused unless the payment covers `extensionCost` — no date
 *   moves on interest that was not paid.
 * - `newDueDate`, when given, is the date the clerk wants instead: any day
 *   after the current due date. Same rule, counted in days
 *   (`extensionCostToDate`); `periods` is then ignored.
 * - Interest is paid before principal: the periods being paid for AND
 *   anything accrued to today. Principal can never be paid down while
 *   interest is owed (see allocateLoanPayment).
 * - More than is owed is refused, never silently absorbed.
 * - A payment that retires the principal closes the loan; the date does not
 *   move on a closed loan.
 * - What goes toward the loan lowers the periods being paid AHEAD in the
 *   same payment: they start after today, so they are figured on the
 *   balance this payment leaves (§ 539.001(11)(e)). The customer is never
 *   charged in advance on money they are handing over right now.
 */
export function planLoanPayment(
  args: PlanLoan & {
    today: string
    periods: number
    /** Move the due date to this day instead of by whole periods. */
    newDueDate?: string | null
    amount: number
    fees?: number | null
  },
): LoanPaymentPlan {
  const amount = r4(args.amount)
  const fees = r4(Math.max(0, toMoney(args.fees ?? 0)))
  if (fees > amount + 0.0001) return { ok: false, reason: 'fees_exceed_amount' }
  const toLoan = r4(Math.max(0, amount - fees))

  const periodDays = periodDaysOf(args.charge)
  const toDate = args.newDueDate ?? null
  const periods = toDate
    ? 0
    : Math.min(MAX_EXTENSION_PERIODS, Math.max(0, Math.floor(args.periods) || 0))
  let moveDays = periods * periodDays
  if (toDate != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return { ok: false, reason: 'bad_due_date' }
    }
    moveDays = daysBetween(args.dueDate, toDate)
    if (!(moveDays > 0) || moveDays > MAX_EXTENSION_PERIODS * periodDays) {
      return { ok: false, reason: 'bad_due_date' }
    }
  }
  const cost = moveCost(args, moveDays, null)
  if (moveDays > 0 && toLoan < cost - 0.0001) {
    return { ok: false, reason: 'extension_underpaid', needed: cost }
  }

  const now = payoffBalance({
    principal: args.principal,
    monthlyRate: args.monthlyRate,
    issueDate: args.issueDate,
    today: args.today,
    events: args.events,
    minMonthlyCharge: args.minMonthlyCharge ?? null,
    charge: args.charge,
  })
  // The interest this payment must cover when `down` of it goes toward the
  // loan today: everything accrued to today, and the move — whose periods
  // still ahead cost less the more is paid down. It never rises with `down`.
  const todayDay = Math.max(0, daysBetween(args.issueDate, args.today))
  const moveCostAfter = (down: number): number =>
    down > 0 ? moveCost(args, moveDays, { day: todayDay, amount: down }) : cost
  const interestDue = (down: number): number =>
    Math.max(now.interestOutstanding, moveCostAfter(down))

  const owed = now.principalOutstanding
  const due0 = interestDue(0)
  let principalPaid = 0
  if (toLoan > due0) {
    // More than the interest: the rest goes toward the loan.
    if (owed + interestDue(owed) < toLoan - 0.0001) {
      return { ok: false, reason: 'exceeds_payoff' }
    }
    let down = r4(toLoan - due0)
    if (interestDue(down) < due0) {
      // Paying down lowers the periods paid ahead, which frees more of the
      // payment for the loan. Find the split where the interest paid is the
      // interest due, to the cent.
      let lo = Math.floor(down * 100) / 100
      let hi = owed
      while (hi - lo > 0.0101) {
        const mid = Math.round(((lo + hi) / 2) * 100) / 100
        if (mid <= lo || mid >= hi) break
        if (mid + interestDue(mid) <= toLoan + 0.00005) lo = mid
        else hi = mid
      }
      down = hi + interestDue(hi) <= toLoan + 0.00005 ? hi : lo
    }
    principalPaid = r4(Math.min(down, owed))
  }
  const interestPaid = r4(toLoan - principalPaid)
  const closes = owed > 0 && r4(owed - principalPaid) <= 0

  return {
    ok: true,
    periods,
    move_days: moveDays,
    extension_cost: moveCostAfter(principalPaid),
    interest_paid: interestPaid,
    principal_paid: principalPaid,
    fees_paid: fees,
    new_due_date:
      moveDays > 0 && !closes ? addDaysIso(args.dueDate, moveDays) : null,
    closes,
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
    LoanMoneyEvent
  >,
  today: string | Date | undefined,
  charge: ChargeModel,
): PayoffResult {
  return payoffBalance({
    principal: toMoney(loan.principal),
    monthlyRate: toMoney(loan.interest_rate_monthly),
    issueDate: loan.issue_date,
    today,
    events,
    minMonthlyCharge: loan.min_monthly_charge ?? null,
    charge,
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
