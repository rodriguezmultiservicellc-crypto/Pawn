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
      'id, tenant_id, status, total, paid_total, returned_total, sale_kind, is_locked, customer_id',
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
