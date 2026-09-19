import { z } from 'zod'

/**
 * Store-credit Zod schemas (patches/0052-0053).
 *
 * Money arrives from FormData as a string. Every amount is coerced and
 * bounded here; the RPC re-checks under a row lock, so these bounds are a
 * courtesy to the clerk, not the authority.
 */

const money = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.coerce.number().finite(),
)

/** Apply store credit as a tender on an open sale. */
export const storeCreditRedeemSchema = z.object({
  sale_id: z.string().uuid(),
  amount: money.pipe(z.number().positive().max(1_000_000)),
})
export type StoreCreditRedeemInput = z.infer<typeof storeCreditRedeemSchema>

/** Undo one redemption on a still-open sale. */
export const storeCreditUndoSchema = z.object({
  sale_id: z.string().uuid(),
  event_id: z.string().uuid(),
})
export type StoreCreditUndoInput = z.infer<typeof storeCreditUndoSchema>

/**
 * Staff issues or corrects credit by hand.
 *
 * `direction` + a positive amount rather than a signed field: a clerk typing
 * "-50" when they meant "50" in a debit box is a real way to hand out money
 * by accident. The reason is mandatory — a manual move of someone's money
 * with no explanation is not auditable.
 */
export const storeCreditAdjustSchema = z.object({
  customer_id: z.string().uuid(),
  direction: z.enum(['add', 'remove']),
  amount: money.pipe(z.number().positive().max(1_000_000)),
  reason: z.string().trim().min(5, 'too_short').max(500),
})
export type StoreCreditAdjustInput = z.infer<typeof storeCreditAdjustSchema>
