'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { returnCreateSchema } from '@/lib/validations/pos'
import { logAudit } from '@/lib/audit'
import { r4, toMoney } from '@/lib/pos/cart'
import {
  computeReturnRefund,
  isReturnableSaleStatus,
} from '@/lib/pos/returns'
import { randomUUID } from 'node:crypto'
import { planCardRefund, totalRefundable } from '@/lib/pos/card-refund'
import { loadRefundableCharges, runCardRefunds, type RefundRun } from '@/lib/pos/card-refund-server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordEarnClawback } from '@/lib/loyalty/events'
import {
  isStoreCreditEnabled,
  issueForReturn as issueStoreCreditForReturn,
} from '@/lib/store-credit/events'
import type { PaymentMethod, SaleStatus } from '@/types/database-aliases'

export type ReturnActionResult = { error?: string; ok?: boolean; redirectTo?: string; detail?: string }

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
      'id, tenant_id, status, subtotal, discount_amount, tax_amount, total, paid_total, returned_total, is_locked, customer_id',
    )
    .eq('id', v.sale_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale) return { error: 'sale_not_found' }

  const { supabase, userId } = await requireRoleInTenant(
    sale.tenant_id,
    STAFF_ROLES,
  )
  const tenantId = sale.tenant_id

  // Only a sale that was completed — i.e. paid — can be returned against.
  // An open sale has collected nothing; refunding it would mint cash or
  // store credit out of thin air.
  if (!isReturnableSaleStatus(sale.status)) {
    return { error: 'saleNotReturnable' }
  }

  // Refunding to store credit needs someone to credit, and the module has
  // to be on. Checked BEFORE the return row is written — a return that
  // records a store-credit refund but issues none is money the customer
  // never gets back.
  if (v.refund_method === 'store_credit') {
    if (!sale.customer_id) return { error: 'store_credit_no_customer' }
    if (!(await isStoreCreditEnabled(createAdminClient(), tenantId))) {
      return { error: 'store_credit_disabled' }
    }
  }

  // Pull EVERY live line of the sale: the refund is a share of the whole
  // sale (discounts and tax travel with the goods), and we need all lines
  // to know whether this return takes back the last of it.
  const { data: liveItems, error: itemsErr } = await supabase
    .from('sale_items')
    .select(
      'id, sale_id, inventory_item_id, description, quantity, unit_price, line_total, returned_qty',
    )
    .eq('sale_id', sale.id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  if (itemsErr) return { error: 'generic' }
  type LiveItem = NonNullable<typeof liveItems>[number]
  const liveById = new Map<string, LiveItem>()
  for (const r of liveItems ?? []) liveById.set(r.id, r)

  // Validate quantities. An id that is not a line of THIS sale is refused.
  const requested = new Map<string, number>()
  for (const ln of v.items) {
    const live = liveById.get(ln.sale_item_id)
    if (!live) return { error: 'item_not_found' }
    if (requested.has(ln.sale_item_id)) return { error: 'validation_failed' }
    const remaining = r4(toMoney(live.quantity) - toMoney(live.returned_qty))
    if (ln.quantity > remaining + 0.0001) return { error: 'returnQtyExceeds' }
    requested.set(ln.sale_item_id, ln.quantity)
  }

  // What the customer actually paid for these goods — net of line and cart
  // discounts, plus their tax, capped at what was paid and not yet refunded.
  // See lib/pos/returns.ts.
  const orderedItems = liveItems ?? []
  const refund = computeReturnRefund({
    sale,
    lines: orderedItems.map((it) => ({
      sold_quantity: it.quantity,
      already_returned: it.returned_qty,
      line_total: it.line_total,
      return_quantity: requested.get(it.id) ?? 0,
    })),
  })
  const lineValueById = new Map<string, number>()
  orderedItems.forEach((it, idx) => lineValueById.set(it.id, refund.lineValues[idx]))
  const returnTotal = refund.total
  if (returnTotal <= 0) return { error: 'nothingToRefund' }

  // ── Card refund FIRST, before anything is written ──────────────────────
  // Only reader (Stripe) charges are refunded by Pawn; what is left on each
  // is what Stripe says. If Stripe refuses, nothing is recorded and the
  // clerk sees why. A sale paid on the card machine (0085) has nothing for
  // Stripe to refund: that refund is done on the machine.
  const returnId = randomUUID()
  let cardRun: RefundRun | null = null
  let cardManual = false
  if (v.refund_method === 'card') {
    const loaded = await loadRefundableCharges(supabase, tenantId, sale.id)
    if (!loaded.ok) return { error: 'cardRefundFailed', detail: loaded.error }
    const available = totalRefundable(loaded.charges)
    if (available <= 0) {
      cardManual = true
    } else {
      const plan = planCardRefund(loaded.charges, returnTotal)
      if (plan.short > 0) return { error: 'cardRefundShort', detail: available.toFixed(2) }
      cardRun = await runCardRefunds({
        supabase,
        tenantId,
        allocations: plan.allocations,
        charges: loaded.charges,
        keyPrefix: `return:${returnId}`,
      })
      if (cardRun.failed) {
        await logAudit({
          tenantId,
          userId,
          action: 'card_refund_failed',
          tableName: 'sale_payments',
          recordId: cardRun.failed.paymentId,
          changes: { sale_id: sale.id, at: 'return', message: cardRun.failed.message, refunded_before_failure: cardRun.refunded },
        })
        // Nothing went back yet → record nothing.
        if (cardRun.refunded === 0) return { error: 'cardRefundFailed', detail: cardRun.failed.message }
      }
    }
  }
  // What actually went back to the customer (a card run that failed part
  // way records only what Stripe refunded).
  const refundedTotal = cardRun?.failed ? cardRun.refunded : returnTotal

  // Insert returns row.
  const { data: ret, error: retErr } = await supabase
    .from('returns')
    .insert({
      id: returnId,
      tenant_id: tenantId,
      sale_id: sale.id,
      status: 'issued',
      reason: v.reason,
      subtotal: refund.subtotal,
      tax_amount: refund.tax,
      total: returnTotal,
      refunded_total: refundedTotal,
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
    // Net value of what came back on this line (discounts applied).
    const lineTotal = lineValueById.get(ln.sale_item_id) ?? 0
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
  if (refund.isFinal || newReturned >= toMoney(sale.total) - 0.0001) {
    newStatus = 'fully_returned'
  } else if (newReturned > 0) newStatus = 'partial_returned'
  await supabase
    .from('sales')
    .update({ returned_total: newReturned, status: newStatus, updated_by: userId })
    .eq('id', sale.id)
    .eq('tenant_id', tenantId)

  // Refund issued as store credit: write the ledger row. Idempotent per
  // return id, so a double-submitted form cannot credit twice.
  if (v.refund_method === 'store_credit' && sale.customer_id) {
    const issued = await issueStoreCreditForReturn({
      admin: createAdminClient(),
      tenantId,
      customerId: sale.customer_id,
      returnId: ret.id,
      amount: returnTotal,
      performedBy: userId,
    })
    if (issued.ok === false) {
      // The return and the restock already landed. Say so plainly rather
      // than pretending the refund went out — staff need to issue the
      // credit by hand from the customer's panel.
      console.error('[pos.return] store credit issue failed', issued.error)
      return {
        error: 'store_credit_issue_failed',
        redirectTo: `/pos/sales/${sale.id}`,
      }
    }
    revalidatePath(`/customers/${sale.customer_id}`)
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
      card_refunded: cardRun?.refunded ?? null,
      card_refund_ids: cardRun?.refundIds ?? null,
      card_refund_manual: cardManual || null,
    },
  })

  // ── Loyalty clawback proportional to returned subtotal (gated) ─────────
  if (sale.customer_id) {
    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('settings')
      .select('loyalty_enabled, loyalty_earn_rate_retail')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (settings?.loyalty_enabled) {
      // Points were earned on the sale's subtotal (before the cart
      // discount), so the clawback uses the same basis.
      const pointsToClaw = Math.floor(
        refund.merchandise * Number(settings.loyalty_earn_rate_retail),
      )
      if (pointsToClaw > 0) {
        await recordEarnClawback({
          admin,
          tenantId,
          customerId: sale.customer_id,
          sourceKind: 'return',
          sourceId: ret.id,
          pointsToClaw,
          reason: 'sale_returned',
        })
      }
    }
  }

  revalidatePath(`/pos/sales/${sale.id}`)
  revalidatePath('/pos')
  // Recorded, but Stripe refunded only part of it: say so plainly — the
  // rest must go back another way.
  if (cardRun?.failed) {
    return {
      error: 'cardRefundPartial',
      detail: `${cardRun.refunded.toFixed(2)} / ${returnTotal.toFixed(2)}`,
      redirectTo: `/pos/sales/${sale.id}`,
    }
  }
  return { ok: true, redirectTo: `/pos/sales/${sale.id}` }
}
