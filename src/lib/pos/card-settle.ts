import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Settle a pending card tender on a sale (patches/0071).
 *
 * A card tender does NOT count toward sales.paid_total when it is added —
 * only when it settles. This is the single code path that makes it count,
 * and it does so inside the database (row lock + status check), so a
 * webhook retry or a double click cannot count the same charge twice.
 *
 * Callers:
 *   - the Stripe webhook, on payment_intent.succeeded for the tender's
 *     PaymentIntent;
 *   - confirmCardPaymentAction — a manager confirming the reader approved
 *     the card (the manual path until the reader integration writes back
 *     on its own).
 *
 * Requires the service-role client; the function is not callable by anon
 * or authenticated. Guard FIRST, then call.
 */

export type CardSettleResult =
  | {
      ok: true
      /** True when this call is the one that added the tender to paid_total. */
      applied: boolean
      /** 'applied' | 'not_pending' (already settled) | 'sale_not_open'. */
      reason: 'applied' | 'not_pending' | 'sale_not_open'
      saleId: string
      tenantId: string
      amount: number
      paidTotal: number
    }
  | { ok: false; error: string }

export async function settleSaleCardPayment(
  admin: SupabaseClient<Database>,
  salePaymentId: string,
): Promise<CardSettleResult> {
  const { data, error } = await admin.rpc('sale_card_payment_succeeded', {
    p_payment_id: salePaymentId,
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, error: 'no_result' }
  const reason =
    row.reason === 'applied' ||
    row.reason === 'not_pending' ||
    row.reason === 'sale_not_open'
      ? row.reason
      : 'not_pending'
  return {
    ok: true,
    applied: row.applied === true,
    reason,
    saleId: row.sale_id,
    tenantId: row.tenant_id,
    amount: Number(row.amount),
    paidTotal: Number(row.paid_total),
  }
}

/**
 * Record the tip Stripe reported on an approved reader charge and credit it
 * to the employee who ran the payment (sale_card_payment_set_tip, 0096).
 * Written once: the counter's status check and the webhook can both call
 * this for the same charge. A tip is never part of the sale's paid total.
 */
export async function recordReaderTip(
  admin: SupabaseClient<Database>,
  salePaymentId: string,
  tip: number,
): Promise<{ recorded: boolean; tip: number; userId: string | null }> {
  if (!(tip > 0)) return { recorded: false, tip: 0, userId: null }
  const { data, error } = await admin.rpc('sale_card_payment_set_tip', {
    p_payment_id: salePaymentId,
    p_tip: tip,
  })
  if (error) {
    // The card WAS charged the tip. Loud, so it can be found and entered.
    console.error(`[pos.tip] tip ${tip} on payment ${salePaymentId} was charged but NOT recorded: ${error.message}`)
    return { recorded: false, tip: 0, userId: null }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { recorded: row?.o_recorded === true, tip: Number(row?.o_tip ?? 0), userId: row?.o_user_id ?? null }
}
