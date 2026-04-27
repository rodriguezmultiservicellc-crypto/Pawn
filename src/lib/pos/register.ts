/**
 * Cash-drawer math for register sessions.
 *
 * expectedCash: opening_cash + cash sales − cash refunds + adjustments.
 * cashVariance: counted − expected. Positive = over, negative = short.
 */

import { r4, toMoney } from './cart'

export function expectedCash(args: {
  opening_cash: number | string | null
  cash_payments: number | string | null
  cash_refunds: number | string | null
  adjustments?: number | string | null
}): number {
  const opening = toMoney(args.opening_cash)
  const payments = toMoney(args.cash_payments)
  const refunds = toMoney(args.cash_refunds)
  const adj = toMoney(args.adjustments ?? 0)
  return r4(opening + payments - refunds + adj)
}

export function cashVariance(args: {
  counted: number | string | null
  expected: number | string | null
}): number {
  const counted = toMoney(args.counted)
  const expected = toMoney(args.expected)
  return r4(counted - expected)
}
