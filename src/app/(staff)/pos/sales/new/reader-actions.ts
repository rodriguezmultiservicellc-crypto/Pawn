'use server'

/**
 * Charge on the Stripe card reader from the New sale counter (patches/0086).
 *
 *   start   → reader + Connect account checked FIRST (nothing is written if
 *             the shop cannot take a reader charge), then sale_create →
 *             PaymentIntent → pending 'reader' tender (sale_add_payment) →
 *             reader.process_payment_intent
 *   status  → polled every ~1.5 s by the dialog (lib/pos/reader-server.ts):
 *             approved → settled + completed; declined / canceled reported
 *   retry   → hand the same PaymentIntent to the reader again
 *   cancel  → stop the reader, cancel the intent, mark the tender failed;
 *             the sale stays OPEN (the clerk takes another payment or voids
 *             it on the sale page — voiding keeps its own role gate)
 *   simulate→ TEST MODE only: a simulated reader "taps" a test card
 *
 * Guards: the counter roles (sale-core SALE_STAFF_ROLES) for the payment's
 * own tenant, read through the user's client (RLS) before any service-role
 * call.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { posErrorKey, saleAddPayment } from '@/lib/pos/money'
import { loadShopReader, pollReaderCharge, type ReaderPoll } from '@/lib/pos/reader-server'
import {
  cancelPaymentIntent,
  cancelReaderAction,
  createCardPresentPaymentIntent,
  processPaymentIntentOnReader,
  simulateReaderTap,
  tenantStripeReady,
  tenantStripeTestMode,
} from '@/lib/stripe/terminal'
import { SALE_STAFF_ROLES, counterContext, createRetailSale, parseRetail } from './sale-core'

export type StartReaderResult =
  | { ok: true; paymentId: string; saleId: string; saleNumber: string | null; total: number }
  | { ok: false; error: string; saleId?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function startReaderChargeAction(formData: FormData): Promise<StartReaderResult> {
  const cc = await counterContext()
  if (!cc.ok) return { ok: false, error: cc.error }
  const c = cc.c

  const parsed = parseRetail(formData)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  // Can this shop take a reader charge at all? Check before writing a sale.
  const reader = await loadShopReader(c.tenantId)
  if (!reader) return { ok: false, error: 'readerNotPaired' }
  if (!(await tenantStripeReady(c.tenantId))) return { ok: false, error: 'tenantStripeNotConnected' }

  const created = await createRetailSale(c, parsed.v)
  if (!created.ok) return { ok: false, error: created.error }
  const sale = created.sale
  revalidatePath('/pos')
  revalidatePath('/pos/sales')

  if (sale.total <= 0) {
    // Nothing to charge on a card; finish it on the sale page.
    return { ok: false, error: 'readerNothingToCharge', saleId: sale.saleId }
  }

  // PaymentIntent on the shop's connected account.
  let piId: string
  try {
    const pi = await createCardPresentPaymentIntent({
      tenantId: c.tenantId,
      amount: sale.total,
      saleId: sale.saleId,
      description: `Sale ${sale.saleNumber ?? sale.saleId}`,
    })
    piId = pi.id
  } catch (e) {
    console.error('[pos.reader] create PaymentIntent failed', e)
    return { ok: false, error: 'readerFailed', saleId: sale.saleId }
  }

  // The pending tender reserves the amount; it counts only once it settles.
  const paid = await saleAddPayment({
    tenantId: c.tenantId,
    userId: c.userId,
    saleId: sale.saleId,
    amount: sale.total,
    method: 'card',
    paymentIntentId: piId,
    readerId: reader.readerId,
    notes: null,
  })
  if (!paid.ok) {
    await cancelPaymentIntent({ tenantId: c.tenantId, paymentIntentId: piId }).catch(() => undefined)
    return { ok: false, error: posErrorKey(paid.error), saleId: sale.saleId }
  }
  await logAudit({
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'sale_payment_add',
    tableName: 'sale_payments',
    recordId: sale.saleId,
    changes: { amount: sale.total, payment_method: 'card', card_entry: 'reader', card_present_status: 'pending', payment_intent: piId },
  })

  try {
    await processPaymentIntentOnReader({ tenantId: c.tenantId, readerId: reader.readerId, paymentIntentId: piId })
  } catch (e) {
    // Reader offline / busy: the tender stays pending — the dialog offers
    // Try again (same intent) or Cancel.
    console.error('[pos.reader] process_payment_intent failed', e)
    return { ok: true, paymentId: paid.data.paymentId, saleId: sale.saleId, saleNumber: sale.saleNumber, total: sale.total }
  }

  return { ok: true, paymentId: paid.data.paymentId, saleId: sale.saleId, saleNumber: sale.saleNumber, total: sale.total }
}

/** The pending reader tender, read through the user's client, then the role guard. */
async function readerPayment(paymentId: string) {
  if (!UUID.test(paymentId)) return null
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: p } = await ctx.supabase
    .from('sale_payments')
    .select('id, tenant_id, sale_id, stripe_payment_intent_id, reader_id, card_entry, card_present_status')
    .eq('id', paymentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!p || p.card_entry !== 'reader' || !p.stripe_payment_intent_id) return null
  const { userId } = await requireRoleInTenant(p.tenant_id, SALE_STAFF_ROLES)
  return { ...p, stripe_payment_intent_id: p.stripe_payment_intent_id, userId }
}

export type ReaderStatusResult = ReaderPoll | { state: 'error'; error: string }

export async function readerChargeStatusAction(paymentId: string): Promise<ReaderStatusResult> {
  const p = await readerPayment(paymentId)
  if (!p) return { state: 'error', error: 'generic' }
  if (p.card_present_status === 'failed') return { state: 'canceled', saleId: p.sale_id }
  try {
    const r = await pollReaderCharge({ tenantId: p.tenant_id, userId: p.userId, payment: p })
    if (r.state === 'approved') {
      revalidatePath('/pos')
      revalidatePath(`/pos/sales/${p.sale_id}`)
    }
    return r
  } catch (e) {
    console.error('[pos.reader] status failed', e)
    return { state: 'error', error: 'readerFailed' }
  }
}

export async function retryReaderChargeAction(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const p = await readerPayment(paymentId)
  if (!p || p.card_present_status !== 'pending' || !p.reader_id) return { ok: false, error: 'generic' }
  try {
    await processPaymentIntentOnReader({
      tenantId: p.tenant_id,
      readerId: p.reader_id,
      paymentIntentId: p.stripe_payment_intent_id,
    })
    return { ok: true }
  } catch (e) {
    console.error('[pos.reader] retry failed', e)
    return { ok: false, error: 'readerFailed' }
  }
}

export async function cancelReaderChargeAction(paymentId: string): Promise<{ ok: boolean; saleId?: string; error?: string }> {
  const p = await readerPayment(paymentId)
  if (!p) return { ok: false, error: 'generic' }
  if (p.card_present_status !== 'pending') return { ok: true, saleId: p.sale_id }

  if (p.reader_id) {
    await cancelReaderAction({ tenantId: p.tenant_id, readerId: p.reader_id }).catch(() => undefined)
  }
  try {
    await cancelPaymentIntent({ tenantId: p.tenant_id, paymentIntentId: p.stripe_payment_intent_id })
  } catch (e) {
    // If Stripe says the intent already SUCCEEDED, do not mark it failed —
    // the next status poll (or the webhook) settles it.
    const st = await pollReaderCharge({ tenantId: p.tenant_id, userId: p.userId, payment: p }).catch(() => null)
    if (st?.state === 'approved') return { ok: false, error: 'readerAlreadyApproved', saleId: p.sale_id }
    console.error('[pos.reader] cancel intent failed', e)
  }

  const { data } = await createAdminClient().rpc('sale_card_payment_failed', {
    p_payment_id: p.id,
    p_reason: 'Cancelled at the counter',
  })
  const row = Array.isArray(data) ? data[0] : data
  if (row?.o_failed) {
    await logAudit({
      tenantId: p.tenant_id,
      userId: p.userId,
      action: 'card_present_failed',
      tableName: 'sale_payments',
      recordId: p.id,
      changes: { reason: 'cancelled_at_counter', payment_intent: p.stripe_payment_intent_id },
    })
  }
  revalidatePath(`/pos/sales/${p.sale_id}`)
  return { ok: true, saleId: p.sale_id }
}

/** TEST MODE ONLY — a simulated reader taps a test card. Refused on a live key. */
export async function simulateReaderTapAction(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const p = await readerPayment(paymentId)
  if (!p || !p.reader_id) return { ok: false, error: 'generic' }
  if (!(await tenantStripeTestMode(p.tenant_id))) return { ok: false, error: 'generic' }
  try {
    await simulateReaderTap({ tenantId: p.tenant_id, readerId: p.reader_id })
    return { ok: true }
  } catch (e) {
    console.error('[pos.reader] simulate tap failed', e)
    return { ok: false, error: 'readerFailed' }
  }
}
