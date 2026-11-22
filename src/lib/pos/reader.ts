/**
 * Stripe Terminal reader charge at the counter (patches/0086). Pure.
 *
 * Flow (server-driven, the Luna Azul pattern on Pawn's Connect account):
 *   1. sale_create → PaymentIntent (card_present) → sale_add_payment
 *      (pending 'reader' row) → reader.process_payment_intent
 *   2. the counter dialog polls every READER_POLL_MS; the server reads the
 *      PaymentIntent (+ the reader's current action) and maps it here
 *   3. approved → settle (sale_card_payment_succeeded, the same idempotent
 *      function the webhook uses) → card details → sale_complete
 *      declined   → the clerk tries again, or pays another way
 *      canceled   → sale_card_payment_failed; the sale stays open
 */

import { z } from 'zod'

export const READER_POLL_MS = 1500
/** After this the dialog stops polling and offers Cancel / Keep waiting. */
export const READER_TIMEOUT_MS = 120_000

export type ReaderChargeState =
  | { state: 'waiting' }
  | { state: 'approved' }
  | { state: 'declined'; message: string | null }
  | { state: 'canceled' }

export type PaymentIntentView = {
  status: string
  last_payment_error?: { message?: string | null; decline_code?: string | null; code?: string | null } | null
}

export type ReaderActionView = {
  type?: string | null
  status?: 'in_progress' | 'succeeded' | 'failed' | string | null
  failure_message?: string | null
  /** The PaymentIntent this action is processing, when Stripe says. */
  payment_intent?: string | null
} | null

/**
 * What the counter should show for this charge right now.
 * Approval wins over everything (automatic capture → 'succeeded';
 * 'requires_capture' also means the card was approved). A reader action
 * that failed for THIS PaymentIntent is a decline even before Stripe moves
 * the intent back to requires_payment_method.
 */
export function readerChargeState(
  pi: PaymentIntentView,
  action: ReaderActionView,
  paymentIntentId: string,
): ReaderChargeState {
  if (pi.status === 'succeeded' || pi.status === 'requires_capture') return { state: 'approved' }
  if (pi.status === 'canceled') return { state: 'canceled' }

  const actionIsOurs =
    !!action && action.type === 'process_payment_intent' &&
    (action.payment_intent == null || action.payment_intent === paymentIntentId)
  if (actionIsOurs && action?.status === 'failed') {
    return { state: 'declined', message: action.failure_message ?? pi.last_payment_error?.message ?? null }
  }
  if (pi.status === 'requires_payment_method' && pi.last_payment_error) {
    return { state: 'declined', message: pi.last_payment_error.message ?? null }
  }
  return { state: 'waiting' }
}

/** Stripe's card brand → the four 0085 brands, everything else 'other'. */
export function mapStripeBrand(brand: string | null | undefined): 'visa' | 'mastercard' | 'amex' | 'discover' | 'other' | null {
  if (!brand) return null
  const b = brand.toLowerCase()
  if (b === 'visa' || b === 'mastercard' || b === 'amex' || b === 'discover') return b
  if (b === 'american_express' || b === 'american express') return 'amex'
  return 'other'
}

/** A Stripe secret key for TEST mode (simulated readers + "simulate tap"). */
export function isStripeTestKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith('sk_test_')
}

/** Stripe's registration code for a simulated WisePOS E (test mode only). */
export const SIMULATED_READER_CODE = 'simulated-wpe'

/** Pairing form: the code the reader shows (e.g. "sepia-cerulean-aardvark") + a name. */
export const pairReaderSchema = z.object({
  registration_code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'code')
    .max(100),
  label: z.string().trim().min(1).max(60),
})
export type PairReaderInput = z.input<typeof pairReaderSchema>

// ── Tips on the reader (patches/0096) ─────────────────────────────────────

/** Settings → Card reader → Tips: the switch and the choices the reader offers. */
export const readerTipsSchema = z.object({
  enabled: z.boolean(),
  /** Whole percents, in the order the reader shows them. One to three. */
  percentages: z.array(z.coerce.number().int().min(1).max(100)).min(1).max(3),
})
export type ReaderTipsInput = z.input<typeof readerTipsSchema>

/**
 * The tip Stripe reports on a card-present PaymentIntent, in dollars.
 * amount_details.tip.amount is cents: null when the reader did not ask,
 * 0 when the customer chose no tip.
 */
export function tipOf(pi: { amount_details?: { tip?: { amount?: number | null } | null } | null }): number {
  const cents = pi.amount_details?.tip?.amount
  return typeof cents === 'number' && isFinite(cents) && cents > 0 ? Math.round(cents) / 100 : 0
}
