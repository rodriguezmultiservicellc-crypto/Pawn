'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { returnCreateSchema } from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { r4, toMoney } from '@/lib/pos/cart'
import { refundCardPayment } from '@/lib/stripe/terminal'
import type { PaymentMethod, SaleStatus } from '@/types/database-aliases'

export type ReturnActionResult = { error?: string; ok?: boolean; redirectTo?: string }

const STAFF_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

type IncomingLine = { sale_item_id: string; quantity: string; restock: boolean }

function readReturnLines(fd: FormData): IncomingLine[] {
  const countRaw = fd.get('items_count')
  const count = Math.max(0, Math.min(200, parseInt(String(countRaw ?? '0'), 10) || 0))
  const out: IncomingLine[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      sale_item_id: String(fd.get(`item_${i}_sale_item_id`) ?? ''),
      quantity: String(fd.get(`item_${i}_quantity`) ?? '0'),
      restock: fd.get(`item_${i}_restock`) === 'on',
    })
  }
  return out
}

export async function createReturnAction(
  formData: FormData,
): Promise<ReturnActionResult> {
  const items = readReturnLines(formData)

  const parsed = returnCreateSchema.safeParse({
    sale_id: formData.get('sale_id'),
    reason: formData.get('reason'),
    refund_method: formData.get('refund_method') ?? 'cash',
    items,
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  // Resolve the sale to get tenant + verify status.
  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      'id, tenant_id, status, total, paid_total, returned_total, is_locked',
    )
    .eq('id', v.sale_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale) return { error: 'sale_not_found' }
  if (sale.status === 'voided') return { error: 'saleNotOpen' }

  const { supabase, userId } = await requireRoleInTenant(
    sale.tenant_id,
    STAFF_ROLES,
  )
  const tenantId = sale.tenant_id

  // Pull the live sale_items to verify quantities + read unit prices.
  const itemIds = v.items.map((i) => i.sale_item_id)
  const { data: liveItems } = await supabase
    .from('sale_items')
    .select(
      'id, sale_id, inventory_item_id, description, quantity, unit_price, returned_qty',
    )
    .in('id', itemIds)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  type LiveItem = NonNullable<typeof liveItems>[number]
  const liveById = new Map<string, LiveItem>()
  for (const r of liveItems ?? []) {
    if (r.sale_id !== sale.id) {
      return { error: 'wrong_sale' }
    }
    liveById.set(r.id, r)
  }

  // Validate quantities + compute totals.
  let subtotal = 0
  for (const ln of v.items) {
    const live = liveById.get(ln.sale_item_id)
    if (!live) return { error: 'item_not_found' }
    const remaining = r4(toMoney(live.quantity) - toMoney(live.returned_qty))
    if (ln.quantity > remaining + 0.0001) return { error: 'returnQtyExceeds' }
    subtotal = r4(subtotal + r4(ln.quantity * toMoney(live.unit_price)))
  }
  // For v1 we mirror sale.tax_rate at return time; pulling it from the sale.
  // Returns row stores tax_amount=0 + total=subtotal so refunds line up.
  const returnTotal = subtotal

  // Insert returns row.
  const { data: ret, error: retErr } = await supabase
    .from('returns')
    .insert({
      tenant_id: tenantId,
      sale_id: sale.id,
      status: 'issued',
      reason: v.reason,
      subtotal,
      tax_amount: 0,
      total: returnTotal,
      refunded_total: returnTotal,
      refund_method: v.refund_method as PaymentMethod,
      refunded_at: new Date().toISOString(),
      performed_by: userId,
      created_by: userId,
    })
    .select('id, return_number')
    .single()
  if (retErr || !ret) return { error: retErr?.message ?? 'return_insert_failed' }

  // Insert return_items + bump sale_items.returned_qty + restock as needed.
  for (const ln of v.items) {
    const live = liveById.get(ln.sale_item_id)
    if (!live) continue
    const lineTotal = r4(ln.quantity * toMoney(live.unit_price))
    await supabase.from('return_items').insert({
      return_id: ret.id,
      tenant_id: tenantId,
      sale_item_id: ln.sale_item_id,
      quantity: ln.quantity,
      unit_price: toMoney(live.unit_price),
      line_total: lineTotal,
      restock: ln.restock,
    })
    const newReturnedQty = r4(toMoney(live.returned_qty) + ln.quantity)
    await supabase
      .from('sale_items')
      .update({ returned_qty: newReturnedQty })
      .eq('id', ln.sale_item_id)
      .eq('tenant_id', tenantId)
    if (ln.restock && live.inventory_item_id) {
      await supabase
        .from('inventory_items')
        .update({ status: 'available', updated_by: userId })
        .eq('id', live.inventory_item_id)
        .eq('tenant_id', tenantId)
        .in('status', ['sold', 'held'])
    }
  }

  // Roll up sale.returned_total + status.
  const newReturned = r4(toMoney(sale.returned_total) + returnTotal)
  let newStatus: SaleStatus = sale.status as SaleStatus
  if (newReturned >= toMoney(sale.total) - 0.0001) newStatus = 'fully_returned'
  else if (newReturned > 0) newStatus = 'partial_returned'
  await supabase
    .from('sales')
    .update({ returned_total: newReturned, status: newStatus, updated_by: userId })
    .eq('id', sale.id)
    .eq('tenant_id', tenantId)

  // If refund_method is 'card', try a refund against the most recent
  // succeeded card payment. Best-effort.
  if (v.refund_method === 'card') {
    const { data: cardPayments } = await supabase
      .from('sale_payments')
      .select('id, amount, payment_method, card_present_status, stripe_payment_intent_id')
      .eq('sale_id', sale.id)
      .eq('payment_method', 'card')
      .eq('card_present_status', 'succeeded')
      .order('occurred_at', { ascending: false })
      .limit(1)
    const target = cardPayments?.[0]
    if (target?.stripe_payment_intent_id) {
      try {
        await refundCardPayment({
          tenantId,
          paymentIntentId: target.stripe_payment_intent_id,
          amount: returnTotal,
        })
      } catch (e) {
        console.error('[pos.return] card refund failed', e)
      }
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'return_create',
    tableName: 'returns',
    recordId: ret.id,
    changes: {
      return_number: ret.return_number,
      sale_id: sale.id,
      total: returnTotal,
      refund_method: v.refund_method,
      item_count: v.items.length,
    },
  })

  revalidatePath(`/pos/sales/${sale.id}`)
  revalidatePath('/pos')
  return { ok: true, redirectTo: `/pos/sales/${sale.id}` }
}
