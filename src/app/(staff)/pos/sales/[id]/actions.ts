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
import { computeBalance, r4, toMoney } from '@/lib/pos/cart'
import {
  createCardPresentPaymentIntent,
  refundCardPayment,
} from '@/lib/stripe/terminal'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  recordEarnSale,
  maybeCreditReferral,
  recordEarnClawback,
  recordRedeemUndo,
  recordRedemption,
} from '@/lib/loyalty/events'
import { computeRedemptionDiscount } from '@/lib/loyalty/math'
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

  const { sale, supabase, userId, tenantId } = await resolveSaleScope(
    v.sale_id,
  )
  if (sale.status !== 'open') return { error: 'saleNotOpen' }

  // Card path: create the PaymentIntent first; failure short-circuits the
  // sale_payments insert. Cash/check just write directly.
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

  const { error: payErr } = await supabase.from('sale_payments').insert({
    sale_id: sale.id,
    tenant_id: tenantId,
    amount: v.amount,
    payment_method: v.payment_method as PaymentMethod,
    card_present_status: cardStatus,
    stripe_payment_intent_id: paymentIntentId,
    reader_id: v.reader_id,
    notes: v.notes,
    performed_by: userId,
  })
  if (payErr) return { error: payErr.message }

  // Roll up paid_total on the parent sale.
  const newPaid = r4(toMoney(sale.paid_total) + v.amount)
  await supabase
    .from('sales')
    .update({ paid_total: newPaid, updated_by: userId })
    .eq('id', sale.id)
    .eq('tenant_id', tenantId)

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
  const { sale, supabase, userId, tenantId } = await resolveSaleScope(saleId)
  if (sale.status !== 'open') return { error: 'saleNotOpen' }
  const balance = computeBalance({ total: sale.total, paid_total: sale.paid_total })
  if (balance > 0.0001) return { error: 'balance_remaining' }

  const { error } = await supabase
    .from('sales')
    .update({
      status: 'completed' as SaleStatus,
      is_locked: true,
      completed_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', sale.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'sale_complete',
    tableName: 'sales',
    recordId: sale.id,
    changes: { total: sale.total },
  })

  // ── Loyalty earn + referral (gated on per-tenant settings.loyalty_enabled) ─
  if (sale.customer_id) {
    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('settings')
      .select(
        'loyalty_enabled, loyalty_earn_rate_retail, loyalty_referral_bonus',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (settings?.loyalty_enabled) {
      await recordEarnSale({
        admin,
        tenantId,
        customerId: sale.customer_id,
        saleId: sale.id,
        subtotal: Number(sale.subtotal),
        rate: Number(settings.loyalty_earn_rate_retail),
      })
      await maybeCreditReferral({
        admin,
        tenantId,
        customerId: sale.customer_id,
        bonusPoints: settings.loyalty_referral_bonus,
      })
    }
  }

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

// ── DEBUG: mark a card payment as succeeded (TEST ONLY) ────────────────────
//
// Replaces the webhook flow until the real Stripe Terminal integration ships.
// Leaves a yellow audit trail and only changes the row's card_present_status.
export async function markCardPaymentSucceededAction(
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

  const { supabase, userId } = await requireRoleInTenant(
    pay.tenant_id,
    STAFF_ROLES,
  )

  const { error } = await supabase
    .from('sale_payments')
    .update({ card_present_status: 'succeeded' })
    .eq('id', pay.id)
    .eq('tenant_id', pay.tenant_id)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: pay.tenant_id,
    userId,
    action: 'card_present_succeeded',
    tableName: 'sale_payments',
    recordId: pay.id,
    changes: { sale_id: pay.sale_id, manual_test_shortcut: true },
  })

  revalidatePath(`/pos/sales/${pay.sale_id}`)
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

  const newDiscount =
    Math.round((Number(sale.discount_amount) + discount) * 10000) / 10000
  const newTotal =
    Math.round(
      (Number(sale.subtotal) - newDiscount + Number(sale.tax_amount)) * 10000,
    ) / 10000

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
  const discountToRemove = Math.round((pointsToRestore / rate) * 10000) / 10000

  const newDiscount = Math.max(
    0,
    Math.round((Number(sale.discount_amount) - discountToRemove) * 10000) / 10000,
  )
  const newTotal =
    Math.round(
      (Number(sale.subtotal) - newDiscount + Number(sale.tax_amount)) * 10000,
    ) / 10000

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
