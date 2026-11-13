'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  layawayAddPaymentSchema,
  layawayCancelSchema,
} from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { r2, toMoney } from '@/lib/pos/cart'
import { afterSaleCompleted, layawayAddPayment, posErrorKey } from '@/lib/pos/money'
import type {
  LayawayStatus,
  PaymentMethod,
  SaleStatus,
} from '@/types/database-aliases'

export type LayawayActionResult = { error?: string; ok?: boolean }

const STAFF_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const
const CANCEL_ROLES = ['owner', 'manager', 'chain_admin'] as const

async function resolveLayawayScope(layawayId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: lay } = await ctx.supabase
    .from('layaways')
    .select(
      'id, tenant_id, sale_id, customer_id, status, total_due, paid_total, balance_remaining, cancellation_fee_pct',
    )
    .eq('id', layawayId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!lay) redirect('/pos/layaways')
  return { lay, ctx }
}

// ── Add layaway payment ────────────────────────────────────────────────────

export async function addLayawayPaymentAction(
  formData: FormData,
): Promise<LayawayActionResult> {
  const parsed = layawayAddPaymentSchema.safeParse({
    layaway_id: formData.get('layaway_id'),
    amount: formData.get('amount'),
    payment_method: formData.get('payment_method') ?? 'cash',
    reader_id: formData.get('reader_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { lay } = await resolveLayawayScope(v.layaway_id)
  if (lay.status !== 'active') return { error: 'wrong_status' }

  const { userId } = await requireRoleInTenant(lay.tenant_id, STAFF_ROLES)

  // One database transaction (patches/0076): the layaway payment, its
  // mirror on the sale, both paid totals — and, when this clears the
  // balance, sale completion (stock to sold, consignor accrual). A card at
  // the layaway counter is run on the shop's own terminal: there is no
  // PaymentIntent to settle later, so it is recorded as money in hand.
  const paid = await layawayAddPayment({
    tenantId: lay.tenant_id,
    userId,
    layawayId: lay.id,
    amount: v.amount,
    method: v.payment_method as PaymentMethod,
    cardStatus: 'not_used',
    notes: v.notes ?? null,
  })
  if (!paid.ok) return { error: posErrorKey(paid.error) }
  const { paidTotal: newPaid, balance: newBalance, completed } = paid.data

  if (completed) {
    await logAudit({
      tenantId: lay.tenant_id,
      userId,
      action: 'layaway_complete',
      tableName: 'layaways',
      recordId: lay.id,
      changes: { total_due: lay.total_due, paid_total: newPaid },
    })
    await afterSaleCompleted({ tenantId: lay.tenant_id, saleId: lay.sale_id })
  }

  await logAudit({
    tenantId: lay.tenant_id,
    userId,
    action: 'layaway_payment_add',
    tableName: 'layaway_payments',
    recordId: lay.id,
    changes: {
      amount: v.amount,
      payment_method: v.payment_method,
      paid_total: newPaid,
      balance_remaining: newBalance,
      completed,
    },
  })

  revalidatePath(`/pos/layaways/${lay.id}`)
  revalidatePath('/pos/layaways')
  revalidatePath('/pos')
  return { ok: true }
}

// ── Cancel layaway ─────────────────────────────────────────────────────────

export async function cancelLayawayAction(
  formData: FormData,
): Promise<LayawayActionResult> {
  const parsed = layawayCancelSchema.safeParse({
    layaway_id: formData.get('layaway_id'),
    reason: formData.get('reason'),
    restock_items: formData.get('restock_items'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { lay } = await resolveLayawayScope(v.layaway_id)
  if (lay.status !== 'active') return { error: 'wrong_status' }

  const { supabase, userId } = await requireRoleInTenant(
    lay.tenant_id,
    CANCEL_ROLES,
  )

  // Mark layaway cancelled.
  await supabase
    .from('layaways')
    .update({
      status: 'cancelled' as LayawayStatus,
      cancelled_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', lay.id)
    .eq('tenant_id', lay.tenant_id)

  // Restock items if requested.
  if (v.restock_items) {
    const { data: items } = await supabase
      .from('sale_items')
      .select('inventory_item_id')
      .eq('sale_id', lay.sale_id)
      .is('deleted_at', null)
    for (const it of items ?? []) {
      if (!it.inventory_item_id) continue
      await supabase
        .from('inventory_items')
        .update({ status: 'available', updated_by: userId })
        .eq('id', it.inventory_item_id)
        .eq('tenant_id', lay.tenant_id)
        .in('status', ['held', 'sold'])
    }
  }

  // Compute refund: paid_total × (1 − cancellation_fee_pct), floored at 0.
  const paid = toMoney(lay.paid_total)
  const fee = r2(paid * toMoney(lay.cancellation_fee_pct))
  const refund = r2(Math.max(0, paid - fee))

  if (refund > 0) {
    // Log a NEGATIVE-amount layaway_payment as the refund reversing entry.
    await supabase.from('layaway_payments').insert({
      layaway_id: lay.id,
      tenant_id: lay.tenant_id,
      amount: -refund,
      payment_method: 'cash',
      card_present_status: 'not_used',
      notes: `cancellation_refund (fee withheld: ${fee.toFixed(2)})`,
      performed_by: userId,
    })
  }

  // Also flip the parent sale to voided so it doesn't show up in active books.
  await supabase
    .from('sales')
    .update({
      status: 'voided' as SaleStatus,
      is_locked: true,
      updated_by: userId,
    })
    .eq('id', lay.sale_id)
    .eq('tenant_id', lay.tenant_id)

  await logAudit({
    tenantId: lay.tenant_id,
    userId,
    action: 'layaway_cancel',
    tableName: 'layaways',
    recordId: lay.id,
    changes: {
      reason: v.reason,
      restock_items: v.restock_items,
      paid_total: paid,
      fee,
      refund,
    },
  })

  revalidatePath(`/pos/layaways/${lay.id}`)
  revalidatePath('/pos/layaways')
  revalidatePath('/pos')
  return { ok: true }
}
