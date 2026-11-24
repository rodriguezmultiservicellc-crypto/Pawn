/**
 * Cash-drawer math for register sessions.
 *
 * Expected cash is worked out in drawer-cash.ts (expectedDrawerCash: the
 * opening count plus every cash movement while the drawer was open).
 * cashVariance: counted − expected. Positive = over, negative = short.
 */

import { r4, toMoney } from './cart'

export function cashVariance(args: {
  counted: number | string | null
  expected: number | string | null
}): number {
  const counted = toMoney(args.counted)
  const expected = toMoney(args.expected)
  return r4(counted - expected)
}
