/**
 * Card refunds on void / return. Pure — the planning half; Stripe calls live
 * in card-refund-server.ts.
 *
 * Rules (never refund silently, never refund twice):
 *   - Only a card taken on the Stripe READER (a PaymentIntent) is refunded
 *     by Pawn. A card-machine payment (0085) is refunded on the machine.
 *   - What is left to refund on a charge is what STRIPE says
 *     (amount − amount_refunded), so earlier partial returns count.
 *   - A refund takes from the newest charge first.
 */

export type RefundableCharge = {
  paymentId: string
  paymentIntentId: string
  /** Dollars still refundable on this charge, per Stripe. */
  remaining: number
}

export type RefundAllocation = { paymentId: string; paymentIntentId: string; amount: number }

const cents = (n: number) => Math.round(n * 100)

/**
 * Split `amount` across the charges, newest first (callers pass them in that
 * order). `short` is what could not be placed on any charge — when it is
 * above zero, Stripe cannot refund the whole amount.
 */
export function planCardRefund(charges: RefundableCharge[], amount: number): { allocations: RefundAllocation[]; short: number } {
  let left = cents(amount)
  const allocations: RefundAllocation[] = []
  for (const c of charges) {
    if (left <= 0) break
    const take = Math.min(left, Math.max(0, cents(c.remaining)))
    if (take <= 0) continue
    allocations.push({ paymentId: c.paymentId, paymentIntentId: c.paymentIntentId, amount: take / 100 })
    left -= take
  }
  return { allocations, short: Math.max(0, left) / 100 }
}

/** Everything still refundable on these charges (a full void refunds this). */
export function totalRefundable(charges: RefundableCharge[]): number {
  return charges.reduce((s, c) => s + Math.max(0, cents(c.remaining)), 0) / 100
}
