import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { recordReaderTip, settleSaleCardPayment } from './card-settle'
import { tipOf } from './reader'
import { afterSaleCompleted, saleComplete } from './money'
import { mapStripeBrand, readerChargeState, type ReaderChargeState, type ReaderActionView } from './reader'
import {
  getTerminalReader,
  retrievePaymentIntent,
  type CardPresentIntentStatus,
  type StripeReader,
} from '@/lib/stripe/terminal'

/**
 * Server side of the counter's card-reader charge (patches/0086). Callers
 * guard the role FIRST; everything here uses the service-role client.
 */

export type ShopReader = {
  readerId: string
  label: string | null
  locationId: string | null
  /** Ask for a tip on the reader (patches/0096). */
  tipsEnabled: boolean
}

/** The shop's paired reader, or null (settings, 0086). */
export async function loadShopReader(tenantId: string): Promise<ShopReader | null> {
  const { data } = await createAdminClient()
    .from('settings')
    .select('stripe_terminal_reader_id, stripe_terminal_reader_label, stripe_terminal_location_id, reader_tips_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!data?.stripe_terminal_reader_id) return null
  return {
    readerId: data.stripe_terminal_reader_id,
    label: data.stripe_terminal_reader_label,
    locationId: data.stripe_terminal_location_id,
    tipsEnabled: data.reader_tips_enabled === true,
  }
}

/** The reader's current action, in the shape readerChargeState reads. */
export function readerActionView(reader: StripeReader | null): ReaderActionView {
  const a = reader?.action
  if (!a) return null
  const pi = a.process_payment_intent?.payment_intent
  return {
    type: a.type ?? null,
    status: a.status ?? null,
    failure_message: a.failure_message ?? null,
    payment_intent: typeof pi === 'string' ? pi : (pi?.id ?? null),
  }
}

function chargeCard(pi: CardPresentIntentStatus): { brand: string | null; last4: string | null } {
  const ch = pi.latest_charge
  if (!ch || typeof ch === 'string') return { brand: null, last4: null }
  const cp = ch.payment_method_details?.card_present
  return { brand: mapStripeBrand(cp?.brand), last4: cp?.last4 ?? null }
}

export type ReaderPoll =
  | (ReaderChargeState & { state: 'waiting' | 'declined' | 'canceled'; saleId: string })
  | {
      state: 'approved'
      saleId: string
      saleNumber: string | null
      total: number
      completed: boolean
      /** Tip the customer added on the reader; 0 when none. Charged on top of the total. */
      tip: number
    }

/**
 * Read the charge from Stripe and move the sale on when it is approved:
 * settle the tender (sale_card_payment_succeeded — idempotent, the webhook
 * calls the same function), store brand + last 4, complete the sale. Safe to
 * call again after it already finished.
 */
export async function pollReaderCharge(args: {
  tenantId: string
  userId: string
  payment: { id: string; sale_id: string; stripe_payment_intent_id: string; reader_id: string | null }
}): Promise<ReaderPoll> {
  const { tenantId, userId, payment } = args
  const pi = await retrievePaymentIntent({ tenantId, paymentIntentId: payment.stripe_payment_intent_id })

  let reader: StripeReader | null = null
  if (payment.reader_id && pi.status !== 'succeeded' && pi.status !== 'requires_capture') {
    try {
      reader = await getTerminalReader({ tenantId, readerId: payment.reader_id })
    } catch {
      reader = null // reader lookup is advisory; the intent decides
    }
  }

  const st = readerChargeState(pi, readerActionView(reader), payment.stripe_payment_intent_id)
  if (st.state !== 'approved') return { ...st, saleId: payment.sale_id }

  const admin = createAdminClient()
  const settled = await settleSaleCardPayment(admin, payment.id)
  if (!settled.ok || settled.tenantId !== tenantId) {
    console.error('[pos.reader] settle failed', payment.id, settled.ok ? 'tenant_mismatch' : settled.error)
    return { state: 'waiting', saleId: payment.sale_id }
  }
  if (settled.applied) {
    await logAudit({
      tenantId,
      userId,
      action: 'card_present_succeeded',
      tableName: 'sale_payments',
      recordId: payment.id,
      changes: { source: 'reader_poll', payment_intent: payment.stripe_payment_intent_id, amount: settled.amount },
    })
  }

  // The tip, if the customer added one: recorded once, credited to the
  // employee who ran this payment. Never part of the sale's paid total.
  const tipped = await recordReaderTip(admin, payment.id, tipOf(pi))
  if (tipped.recorded) {
    await logAudit({
      tenantId,
      userId,
      action: 'card_tip_recorded',
      tableName: 'sale_payments',
      recordId: payment.id,
      changes: { source: 'reader_poll', payment_intent: payment.stripe_payment_intent_id, tip: tipped.tip, tip_user_id: tipped.userId },
    })
  }

  const card = chargeCard(pi)
  if (card.last4 || card.brand) {
    await admin.rpc('sale_card_payment_set_details', {
      p_payment_id: payment.id,
      p_last4: card.last4 ?? '',
      p_brand: card.brand ?? '',
    })
  }

  // Complete once the money covers the total (the database checks; a split
  // payment that still owes simply stays open).
  const done = await saleComplete({ tenantId, userId, saleId: payment.sale_id })
  const completedNow = done.ok && done.data.completed
  if (completedNow) {
    await logAudit({
      tenantId,
      userId,
      action: 'sale_complete',
      tableName: 'sales',
      recordId: payment.sale_id,
      changes: { at: 'reader' },
    })
    await afterSaleCompleted({ tenantId, saleId: payment.sale_id })
  }

  const { data: sale } = await admin
    .from('sales')
    .select('sale_number, total, status')
    .eq('id', payment.sale_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return {
    state: 'approved',
    saleId: payment.sale_id,
    saleNumber: sale?.sale_number ?? null,
    total: Number(sale?.total ?? settled.amount),
    completed: sale?.status === 'completed',
    tip: tipped.tip,
  }
}
