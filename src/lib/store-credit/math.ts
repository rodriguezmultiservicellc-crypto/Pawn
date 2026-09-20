/**
 * Store-credit arithmetic. Pure functions — no I/O, no Supabase.
 *
 * Money is numeric(18,4) in the database (CLAUDE.md Rule 11), so every
 * amount that crosses the boundary is rounded to 4 decimals with the same
 * helper the POS cart uses. Display rounds to 2.
 */

import { r2, r4, toMoney } from '@/lib/money'

// Re-exported so callers of this module keep one import for store-credit
// arithmetic. The implementations live in lib/money.ts.
export { r2, r4, toMoney }

/**
 * The most store credit that can go onto a sale right now: never more than
 * the customer holds, never more than the sale still owes.
 *
 * Returned at cent precision because it seeds an amount input a clerk can
 * edit — offering 12.3456 would be nonsense on a register. Rounding DOWN
 * (not nearest) keeps the suggestion inside both ceilings.
 */
export function maxRedeemable(args: {
  balance: number
  balanceDue: number
}): number {
  const cap = Math.min(toMoney(args.balance), toMoney(args.balanceDue))
  if (!(cap > 0)) return 0
  return Math.floor(r4(cap) * 100) / 100
}

export type RedeemValidation =
  | { ok: true; amount: number }
  | {
      ok: false
      error:
        | 'invalid_amount'
        | 'insufficient_balance'
        | 'exceeds_balance_due'
    }

/**
 * Client/server-shared pre-check before calling the RPC. The RPC re-checks
 * everything under a row lock — this exists to give a translated error
 * without a round trip, never as the authority.
 */
export function validateRedemption(args: {
  amount: number
  balance: number
  balanceDue: number
}): RedeemValidation {
  const amount = r4(toMoney(args.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_amount' }
  }
  // 0.0001 of slack: the sale total and paid_total are both rounded to the
  // numeric(18,4) grid, so "pay off exactly" must not trip on a last-bit
  // floating-point difference.
  if (amount > r4(toMoney(args.balance)) + 0.0001) {
    return { ok: false, error: 'insufficient_balance' }
  }
  if (amount > r4(toMoney(args.balanceDue)) + 0.0001) {
    return { ok: false, error: 'exceeds_balance_due' }
  }
  return { ok: true, amount }
}

