import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { refundCardPayment, retrievePaymentIntent } from '@/lib/stripe/terminal'
import type { RefundAllocation, RefundableCharge } from './card-refund'

/**
 * Stripe half of card refunds on void / return (see card-refund.ts for the
 * rules). Callers guard the role FIRST and pass the user's client, so the
 * status writes go through RLS.
 */

/**
 * The sale's reader-card charges that can still be refunded, newest first,
 * with what Stripe says is left on each. A charge Stripe cannot be read for
 * is returned as an error — never guessed.
 */
export async function loadRefundableCharges(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  saleId: string,
): Promise<{ ok: true; charges: RefundableCharge[] } | { ok: false; error: string }> {
  const { data: rows, error } = await supabase
    .from('sale_payments')
    .select('id, stripe_payment_intent_id, occurred_at')
    .eq('sale_id', saleId)
    .eq('tenant_id', tenantId)
    .eq('payment_method', 'card')
    .eq('card_present_status', 'succeeded')
    .not('stripe_payment_intent_id', 'is', null)
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
  if (error) return { ok: false, error: error.message }

  const charges: RefundableCharge[] = []
  for (const r of rows ?? []) {
    const piId = r.stripe_payment_intent_id as string
    try {
      const pi = await retrievePaymentIntent({ tenantId, paymentIntentId: piId })
      const ch = pi.latest_charge
      if (!ch || typeof ch === 'string' || ch.amount == null) {
        return { ok: false, error: `no charge on ${piId}` }
      }
      charges.push({
        paymentId: r.id,
        paymentIntentId: piId,
        remaining: Math.max(0, ch.amount - (ch.amount_refunded ?? 0)) / 100,
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'stripe_error' }
    }
  }
  return { ok: true, charges }
}

export type RefundRun = {
  /** Dollars Stripe actually refunded in this run. */
  refunded: number
  refundIds: string[]
  /** Set when a refund failed; the run stopped there. */
  failed: { paymentId: string; message: string } | null
}

/**
 * Refund each allocation on Stripe, in order, stopping at the first failure.
 * Idempotency key = `${keyPrefix}:${paymentId}:${cents}` — a retry of the
 * same void / return gets Stripe's first refund back, never a second one.
 * A charge refunded down to zero is marked 'refunded' on its payment row.
 */
export async function runCardRefunds(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  allocations: RefundAllocation[]
  charges: RefundableCharge[]
  keyPrefix: string
}): Promise<RefundRun> {
  const { supabase, tenantId, allocations, charges, keyPrefix } = args
  const run: RefundRun = { refunded: 0, refundIds: [], failed: null }
  for (const a of allocations) {
    try {
      const r = await refundCardPayment({
        tenantId,
        paymentIntentId: a.paymentIntentId,
        amount: a.amount,
        idempotencyKey: `${keyPrefix}:${a.paymentId}:${Math.round(a.amount * 100)}`,
      })
      run.refunded = Math.round((run.refunded + a.amount) * 100) / 100
      run.refundIds.push(r.id)
      const before = charges.find((c) => c.paymentId === a.paymentId)
      if (before && Math.round(before.remaining * 100) - Math.round(a.amount * 100) <= 0) {
        await supabase
          .from('sale_payments')
          .update({ card_present_status: 'refunded' })
          .eq('id', a.paymentId)
          .eq('tenant_id', tenantId)
      }
    } catch (e) {
      run.failed = { paymentId: a.paymentId, message: e instanceof Error ? e.message : 'stripe_error' }
      break
    }
  }
  return run
}
