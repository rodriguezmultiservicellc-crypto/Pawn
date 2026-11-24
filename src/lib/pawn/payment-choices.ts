/**
 * The "move the due date" choices a payment offers on one ticket: one
 * period, two, … each with what it costs and where it leaves the due date.
 * Shared by the single payment dialog and "Pay together" so both offer the
 * same thing. Pure; the server prices the pick again (planLoanPayment).
 */

import {
  MAX_EXTENSION_PERIODS,
  addDaysIso,
  extensionCost,
  periodsToBringCurrent,
  planLoanPayment,
} from './math'

type PlanArgs = Parameters<typeof planLoanPayment>[0]

/**
 * The amount to collect so that, after the fees and the interest the server
 * takes first (owed to date, and the move picked), exactly `toPrincipal` goes
 * toward the loan. Found by asking planLoanPayment — the function the server
 * runs — and correcting: a paydown can lower the move's own cost, so the
 * answer is not simply cost + fees + principal: when time is paid ahead,
 * each dollar more toward the loan also lowers that time's interest, so a
 * dollar collected puts MORE than a dollar on the principal. The steps use
 * the slope seen between tries (a secant step), which lands at once on a
 * straight stretch. Amounts are whole cents, so the principal can land a
 * cent off what was asked; the preview shows the exact split.
 * Null when no amount works (the plan refuses it — e.g. more than the
 * payoff).
 */
export function amountForPrincipal(
  args: Omit<PlanArgs, 'amount' | 'fees'> & { fees: number; toPrincipal: number; startAt: number },
): number | null {
  const { toPrincipal, startAt, ...rest } = args
  const r2 = (x: number) => Math.round(x * 100) / 100
  let amount = r2(Math.max(startAt, 0) + args.fees + toPrincipal)
  let prev: { amount: number; principal: number } | null = null
  let best: { amount: number; off: number } | null = null
  for (let i = 0; i < 12; i++) {
    if (!(amount > 0)) break
    const plan = planLoanPayment({ ...rest, amount })
    if (!plan.ok) {
      // Short of the move's interest: raise to what it needs and try again.
      if (plan.reason === 'extension_underpaid' && plan.needed != null) {
        amount = r2(plan.needed + args.fees + toPrincipal)
        prev = null
        continue
      }
      break
    }
    const diff = toPrincipal - plan.principal_paid
    if (!best || Math.abs(diff) < best.off) best = { amount, off: Math.abs(diff) }
    if (Math.abs(diff) < 0.005) return amount
    const slope =
      prev && amount !== prev.amount ? (plan.principal_paid - prev.principal) / (amount - prev.amount) : 1
    prev = { amount, principal: plan.principal_paid }
    const next = r2(amount + diff / (slope > 0.01 ? slope : 1))
    if (next === amount) break
    amount = next
  }
  // A cent of amount can move the principal by more than a cent.
  return best && best.off <= 0.02 ? best.amount : null
}

/** Periods always offered, and how many more past the one that brings a
 *  late ticket current — a customer may pay ahead as far as they like. */
const MIN_CHOICES = 6
const CHOICES_PAST_CURRENT = 6

export type MoveChoice = { periods: number; days: number; cost: number; due: string }

export function moveChoices(
  loan: Parameters<typeof extensionCost>[0],
  today: string,
  payoff: number,
): { startPeriods: number; choices: MoveChoice[] } {
  const periodDays = loan.charge.periodDays
  // Open on the move that brings the ticket current: one period for a
  // customer on time, more for one who is late.
  const startPeriods = periodsToBringCurrent(loan.dueDate, today, periodDays)
  // The list always runs past today, however late the ticket is: a ticket
  // a year behind must still be able to reach a date in the future.
  const count = Math.min(MAX_EXTENSION_PERIODS, Math.max(MIN_CHOICES, startPeriods + CHOICES_PAST_CURRENT))
  const choices = Array.from({ length: count }, (_, i) => {
    const periods = i + 1
    return {
      periods,
      days: periods * periodDays,
      cost: extensionCost(loan, periods),
      due: addDaysIso(loan.dueDate, periods * periodDays),
    }
    // Nobody pays ahead more than it costs to redeem: those are not offered
    // (the move that brings the ticket current always is).
  }).filter((c) => c.periods <= startPeriods || c.cost <= payoff + 0.004)
  return { startPeriods, choices }
}
