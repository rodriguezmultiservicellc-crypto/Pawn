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
} from './math'

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
