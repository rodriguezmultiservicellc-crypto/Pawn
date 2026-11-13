'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  saleAddPaymentSchema,
  saleVoidSchema,
} from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { computeBalance, r2, toMoney } from '@/lib/pos/cart'
import { afterSaleCompleted, posErrorKey, saleAddPayment, saleComplete } from '@/lib/pos/money'
import {
  createCardPresentPaymentIntent,
  refundCardPayment,
} from '@/lib/stripe/terminal'
import { createAdminClient } from '@/lib/supabase/admin'
import { settleSaleCardPayment } from '@/lib/pos/card-settle'
import {
  recordEarnClawback,
  recordRedeemUndo,
  recordRedemption,
} from '@/lib/loyalty/events'
import { computeRedemptionDiscount } from '@/lib/loyalty/math'
import { restoreForSale as restoreStoreCreditForSale } from '@/lib/store-credit/events'
import type { PaymentMethod, SaleStatus } from '@/types/database-aliases'

export type SaleActionResult = { error?: string; ok?: boolean }

const STAFF_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

const VOID_ROLES = ['owner', 'manager', 'chain_admin'] as const

async function resolveSaleScope(saleId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      'id, tenant_id, status, total, paid_total, returned_total, sale_kind, is_locked, customer_id, subtotal, discount_amount, tax_amount',
    )
    .eq('id', saleId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale) redirect('/pos')
  const { supabase, userId } = await requireRoleInTenant(
    sale.tenant_id,
    STAFF_ROLES,
  )
  return { sale, supabase, userId, tenantId: sale.tenant_id }
}

// ── Add payment ────────────────────────────────────────────────────────────

export async function addPaymentAction(
  formData: FormData,
): Promise<SaleActionResult> {
  const parsed = saleAddPaymentSchema.safeParse({
    sale_id: formData.get('sale_id'),
    amount: formData.get('amount'),
    payment_method: formData.get('payment_method') ?? 'cash',
    reader_id: formData.get('reader_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { sale, userId, tenantId } = await resolveSaleScope(v.sale_id)
  if (sale.status !== 'open') return { error: 'saleNotOpen' }
  // Cheap early refusal before a PaymentIntent is created; the database
  // re-checks under a row lock (pending card tenders included).
  if (r2(v.amount) > computeBalance({ total: sale.total, paid_total: sale.paid_total })) {
    return { error: 'paymentExceedsBalance' }
  }

  // Card path: create the PaymentIntent first; failure short-circuits the
  // payment row. Cash/check go straight to the database function.
  let paymentIntentId: string | null = null
  let cardStatus: 'pending' | 'not_used' = 'not_used'
  if (v.payment_method === 'card') {
    try {
      const pi = await createCardPresentPaymentIntent({
        tenantId,
        amount: v.amount,
        saleId: sale.id,
      })
      paymentIntentId = pi.id
      cardStatus = 'pending'
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'tenant_stripe_not_connected'
      return {
        error:
          msg === 'tenant_stripe_not_connected'
            ? 'tenantStripeNotConnected'
            : msg,
      }
    }
  }

  // One database function writes the tender and moves paid_total in place
  // under a row lock (patches/0076). A card tender is only a PaymentIntent
  // at this point: it is stored 'pending' and stays OUT of paid_total until
  // it settles (Stripe webhook, or a manager confirming — card-settle.ts).
  const paid = await saleAddPayment({
    tenantId,
    userId,
    saleId: sale.id,
    amount: v.amount,
    method: v.payment_method as PaymentMethod,
    paymentIntentId,
    readerId: v.reader_id ?? null,
    notes: v.notes ?? null,
  })
  if (!paid.ok) {
    if (paymentIntentId) {
      // The reader never saw this intent; leave a trace for reconciliation.
      console.error('[pos.addPayment] refused after PaymentIntent created', paymentIntentId, paid.error)
    }
    return { error: posErrorKey(paid.error) }
  }
  const newPaid = paid.data.paidTotal

  await logAudit({
    tenantId,
    userId,
    action: 'sale_payment_add',
    tableName: 'sale_payments',
    recordId: sale.id,
    changes: {
      amount: v.amount,
      payment_method: v.payment_method,
      card_present_status: cardStatus,
      paid_total: newPaid,
    },
  })

  revalidatePath(`/pos/sales/${sale.id}`)
  revalidatePath('/pos')
  return { ok: true }
}

// ── Complete sale ──────────────────────────────────────────────────────────

export async function completeSaleAction(
  saleId: string,
): Promise<SaleActionResult> {
  if (!saleId) return { error: 'missing_sale_id' }
  const { sale, userId, tenantId } = await resolveSaleScope(saleId)
  if (sale.status !== 'open') return { error: 'saleNotOpen' }

  // The database re-reads the sale under a row lock: open, and settled money
  // (paid_total; a pending card is not in it) covers the total in cents.
  const done = await saleComplete({ tenantId, userId, saleId: sale.id })
  if (!done.ok) return { error: posErrorKey(done.error) }
  if (!done.data.completed) return { error: 'saleAlreadyCompleted' }

  await logAudit({
    tenantId,
    userId,
    action: 'sale_complete',
    tableName: 'sales',
    recordId: sale.id,
    changes: { total: sale.total },
  })

  // Loyalty earn + referral (gated on settings.loyalty_enabled; idempotent).
  await afterSaleCompleted({ tenantId, saleId: sale.id })

  revalidatePath(`/pos/sales/${sale.id}`)
  revalidatePath('/pos')
  return { ok: true }
}

// ── Void sale ──────────────────────────────────────────────────────────────

export async function voidSaleAction(
  formData: FormData,
): Promise<SaleActionResult> {
  const parsed = saleVoidSchema.safeParse({
    sale_id: formData.get('sale_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      'id, tenant_id, status, total, paid_total, customer_id',
    )
    .eq('id', v.sale_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale) redirect('/pos')
  if (sale.status === 'voided') return { error: 'already_voided' }

  const { supabase, userId } = await requireRoleInTenant(
    sale.tenant_id,
    VOID_ROLES,
  )

  // For each card payment, attempt a refund best-effort.
  const { data: payments } = await supabase
    .from('sale_payments')
    .select(
      'id, amount, payment_method, card_present_status, stripe_payment_intent_id',
    )
    .eq('sale_id', sale.id)
    .is('deleted_at', null)

  for (const p of payments ?? []) {
    if (
      p.payment_method === 'card' &&
      p.card_present_status === 'succeeded' &&
      p.stripe_payment_intent_id
    ) {
      try {
        await refundCardPayment({
          tenantId: sale.tenant_id,
          paymentIntentId: p.stripe_payment_intent_id,
          amount: toMoney(p.amount),
        })
        await supabase
          .from('sale_payments')
          .update({ card_present_status: 'refunded' })
          .eq('id', p.id)
          .eq('tenant_id', sale.tenant_id)
      } catch (e) {
        // Record the failure but do not block the void.
        console.error('[pos.voidSale] refund failed', e)
      }
    }
  }

  // Update sale -> voided + locked.
  const { error: upErr } = await supabase
    .from('sales')
    .update({
      status: 'voided' as SaleStatus,
      is_locked: true,
      updated_by: userId,
    })
    .eq('id', sale.id)
    .eq('tenant_id', sale.tenant_id)
  if (upErr) return { error: upErr.message }

  // Restock any inventory items linked to this sale (only flip back if
  // currently 'sold' or 'held' — don't trample a status the receiving side
  // already set).
  const { data: items } = await supabase
    .from('sale_items')
    .select('inventory_item_id')
    .eq('sale_id', sale.id)
    .is('deleted_at', null)
  for (const it of items ?? []) {
    if (!it.inventory_item_id) continue
    await supabase
      .from('inventory_items')
      .update({ status: 'available', updated_by: userId })
      .eq('id', it.inventory_item_id)
      .eq('tenant_id', sale.tenant_id)
      .in('status', ['sold', 'held'])
  }

  await logAudit({
    tenantId: sale.tenant_id,
    userId,
    action: 'sale_void',
    tableName: 'sales',
    recordId: sale.id,
    changes: { reason: v.reason, total: sale.total },
  })

  // ── Store credit: put every redemption on this sale back ───────────────
  //
  // The payment rows stay on the voided sale as history — same as the card
  // refund above, which leaves its row and marks it refunded. What matters
  // is that the customer gets their credit back. Not gated on
  // settings.store_credit_enabled: a shop that switched the module off
  // after taking someone's credit still owes it.
  if (sale.customer_id) {
    const restored = await restoreStoreCreditForSale({
      admin: createAdminClient(),
      tenantId: sale.tenant_id,
      saleId: sale.id,
      performedBy: userId,
    })
    if (restored.restoredCount > 0) {
      await logAudit({
        tenantId: sale.tenant_id,
        userId,
        action: 'store_credit_restore',
        tableName: 'store_credit_events',
        recordId: sale.id,
        changes: {
          reason: 'sale_voided',
          customer_id: sale.customer_id,
          restored_count: restored.restoredCount,
          restored_amount: restored.restoredAmount,
        },
      })
      revalidatePath(`/customers/${sale.customer_id}`)
    }
  }

  // ── Loyalty clawback + redemption reversal (gated) ─────────────────────
  if (sale.customer_id) {
    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('settings')
      .select('loyalty_enabled')
      .eq('tenant_id', sale.tenant_id)
      .maybeSingle()
    if (settings?.loyalty_enabled) {
      // 1. Sum any earn_sale rows posted for this sale → clawback that much.
      const { data: earnRows } = await admin
        .from('loyalty_events')
        .select('points_delta')
        .eq('source_kind', 'sale')
        .eq('source_id', sale.id)
        .eq('kind', 'earn_sale')
      const earnedPoints = (earnRows ?? []).reduce(
        (acc, r) => acc + r.points_delta,
        0,
      )
      if (earnedPoints > 0) {
        await recordEarnClawback({
          admin,
          tenantId: sale.tenant_id,
          customerId: sale.customer_id,
          sourceKind: 'sale',
          sourceId: sale.id,
          pointsToClaw: earnedPoints,
          reason: 'sale_voided',
        })
      }

      // 2. Reverse every redeem_pos row tied to this sale (one undo each).
      const { data: redemptions } = await admin
        .from('loyalty_events')
        .select('id, points_delta')
        .eq('source_kind', 'sale')
        .eq('source_id', sale.id)
        .eq('kind', 'redeem_pos')
      for (const r of redemptions ?? []) {
        // points_delta is negative (e.g. -1000); restore is the absolute value.
        await recordRedeemUndo({
          admin,
          tenantId: sale.tenant_id,
          customerId: sale.customer_id,
          originalEventId: r.id,
          saleId: sale.id,
          pointsToRestore: Math.abs(r.points_delta),
          reason: 'sale_voided',
          performedBy: userId,
        })
      }
    }
  }

  revalidatePath(`/pos/sales/${sale.id}`)
  revalidatePath('/pos')
  return { ok: true }
}

// ── Manager confirms a card tender was approved ────────────────────────────
//
// The normal path is the Stripe webhook (payment_intent.succeeded) settling
// the tender on its own. This is the manual path for when the reader shows
// "approved" but the webhook has not written back: an owner / manager /
// chain_admin vouches for it. It is what makes the tender count toward
// paid_total, so it is NOT open to clerks — a clerk could otherwise add a
// card tender, never present a card, confirm it themselves and complete the
// sale. Every use is audited with the confirming user.
export async function confirmCardPaymentAction(
  salePaymentId: string,
): Promise<SaleActionResult> {
  if (!salePaymentId) return { error: 'missing_id' }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: pay } = await ctx.supabase
    .from('sale_payments')
    .select('id, sale_id, tenant_id, payment_method, card_present_status')
    .eq('id', salePaymentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!pay) return { error: 'payment_not_found' }
  if (pay.payment_method !== 'card') return { error: 'wrong_method' }

  // Guard first, admin client second.
  const { userId } = await requireRoleInTenant(pay.tenant_id, VOID_ROLES)

  const settled = await settleSaleCardPayment(createAdminClient(), pay.id)
  if (!settled.ok) return { error: 'generic' }
  if (settled.tenantId !== pay.tenant_id) return { error: 'generic' }

  await logAudit({
    tenantId: pay.tenant_id,
    userId,
    action: 'card_present_succeeded',
    tableName: 'sale_payments',
    recordId: pay.id,
    changes: {
      sale_id: pay.sale_id,
      via: 'manager_confirmation',
      applied: settled.applied,
      reason: settled.reason,
      amount: settled.amount,
      paid_total: settled.paidTotal,
    },
  })

  revalidatePath(`/pos/sales/${pay.sale_id}`)
  revalidatePath('/pos')
  if (settled.reason === 'sale_not_open') return { error: 'cardSaleNotOpen' }
  return { ok: true }
}

// ── Loyalty: redeem points on an open sale ────────────────────────────────

export type RedeemPointsState = {
  error?:
    | 'missing_sale_id'
    | 'missing_points'
    | 'invalid_points'
    | 'sale_not_open'
    | 'no_customer'
    | 'loyalty_disabled'
    | 'no_balance'
    | 'insufficient_balance'
    | 'insert_failed'
    | string
  ok?: boolean
}

export async function redeemPointsOnSaleAction(
  _prev: RedeemPointsState,
  formData: FormData,
): Promise<RedeemPointsState> {
  const saleId = String(formData.get('sale_id') ?? '')
  if (!saleId) return { error: 'missing_sale_id' }

  const pointsRaw = String(formData.get('points') ?? '')
  if (!pointsRaw) return { error: 'missing_points' }
  const points = Number.parseInt(pointsRaw, 10)
  if (!Number.isFinite(points) || points <= 0) return { error: 'invalid_points' }

  const { sale, supabase, userId, tenantId } = await resolveSaleScope(saleId)
  if (sale.status !== 'open') return { error: 'sale_not_open' }
  if (!sale.customer_id) return { error: 'no_customer' }

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('settings')
    .select('loyalty_enabled, loyalty_redemption_rate')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!settings?.loyalty_enabled) return { error: 'loyalty_disabled' }

  const rate = Number(settings.loyalty_redemption_rate)

  const { data: customer } = await admin
    .from('customers')
    .select('loyalty_points_balance')
    .eq('id', sale.customer_id)
    .maybeSingle()
  const balance = customer?.loyalty_points_balance ?? 0
  if (balance <= 0) return { error: 'no_balance' }
  if (points > balance) return { error: 'insufficient_balance' }

  const { discount, pointsConsumed } = computeRedemptionDiscount({
    points,
    rate,
    saleSubtotal: Number(sale.subtotal),
    alreadyDiscounted: Number(sale.discount_amount),
  })
  if (pointsConsumed <= 0) return { error: 'no_balance' }

  // Cents, like every other sale total (patches/0076).
  const newDiscount = r2(Number(sale.discount_amount) + discount)
  const newTotal = r2(Number(sale.subtotal) - newDiscount + Number(sale.tax_amount))

  const { error: upErr } = await supabase
    .from('sales')
    .update({
      discount_amount: newDiscount,
      total: newTotal,
      updated_by: userId,
    })
    .eq('id', sale.id)
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
  if (upErr) return { error: upErr.message }

  const inserted = await recordRedemption({
    admin,
    tenantId,
    customerId: sale.customer_id,
    saleId: sale.id,
    pointsConsumed,
    performedBy: userId,
  })
  if (!inserted) return { error: 'insert_failed' }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'sales',
    recordId: sale.id,
    changes: { kind: 'loyalty_redeem', points: pointsConsumed, discount },
  })

  revalidatePath(`/pos/sales/${sale.id}`)
  return { ok: true }
}

// ── Loyalty: undo a redemption on an open sale ────────────────────────────

export type UndoRedemptionState = {
  error?: string
  ok?: boolean
}

export async function undoRedemptionAction(
  _prev: UndoRedemptionState,
  formData: FormData,
): Promise<UndoRedemptionState> {
  const saleId = String(formData.get('sale_id') ?? '')
  const eventId = String(formData.get('event_id') ?? '')
  if (!saleId || !eventId) return { error: 'validation_failed' }

  const { sale, supabase, userId, tenantId } = await resolveSaleScope(saleId)
  if (sale.status !== 'open') return { error: 'sale_not_open' }
  if (!sale.customer_id) return { error: 'no_customer' }

  const admin = createAdminClient()

  const { data: ev } = await admin
    .from('loyalty_events')
    .select('id, kind, points_delta, source_kind, source_id')
    .eq('id', eventId)
    .maybeSingle()
  if (!ev) return { error: 'event_not_found' }
  if (ev.kind !== 'redeem_pos' || ev.source_kind !== 'sale' || ev.source_id !== sale.id) {
    return { error: 'event_mismatch' }
  }

  const { data: settings } = await admin
    .from('settings')
    .select('loyalty_redemption_rate')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const rate = settings?.loyalty_redemption_rate
    ? Number(settings.loyalty_redemption_rate)
    : 100

  const pointsToRestore = Math.abs(ev.points_delta)
  const discountToRemove = r2(pointsToRestore / rate)

  const newDiscount = Math.max(0, r2(Number(sale.discount_amount) - discountToRemove))
  const newTotal = r2(Number(sale.subtotal) - newDiscount + Number(sale.tax_amount))

  const { error: upErr } = await supabase
    .from('sales')
    .update({
      discount_amount: newDiscount,
      total: newTotal,
      updated_by: userId,
    })
    .eq('id', sale.id)
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
  if (upErr) return { error: upErr.message }

  await recordRedeemUndo({
    admin,
    tenantId,
    customerId: sale.customer_id,
    originalEventId: ev.id,
    saleId: sale.id,
    pointsToRestore,
    reason: 'undo_redemption',
    performedBy: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'sales',
    recordId: sale.id,
    changes: {
      kind: 'loyalty_redeem_undo',
      original_event_id: ev.id,
      points: pointsToRestore,
    },
  })

  revalidatePath(`/pos/sales/${sale.id}`)
  return { ok: true }
}
