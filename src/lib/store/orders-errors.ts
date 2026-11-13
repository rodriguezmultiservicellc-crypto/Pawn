/** Refusals a shopper can see at checkout. Pure (tested in store.test.ts). */

export const ORDER_ERRORS = [
  'checkout_off',
  'too_many_items',
  'item_unavailable',
  'fulfillment_off',
  'order_over_limit',
  'cannot_checkout',
  'too_many_pending',
  'stripe_not_connected',
] as const
export type OrderError = (typeof ORDER_ERRORS)[number] | 'generic'

export function orderError(message: string | null | undefined): OrderError {
  const m = message ?? ''
  if (m.includes('tenant_stripe_not_connected')) return 'stripe_not_connected'
  return ORDER_ERRORS.find((t) => m.includes(t)) ?? 'generic'
}
