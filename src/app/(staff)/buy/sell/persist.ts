import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { MetalSaleLineInput } from '@/lib/validations/metal-sale'
import type { RateMaps, Tender } from '@/lib/metal-counter/math'
import { resolveRate } from '@/lib/metal-counter/math'
import { r4 } from '@/lib/pos/cart'

type Client = SupabaseClient<Database>

export type MetalSaleTotals = {
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
}

export type PersistMetalSaleArgs = {
  supabase: Client
  tenantId: string
  userId: string
  registerSessionId: string | null
  customerId: string | null
  counterpartyName: string | null
  notes: string | null
  totals: MetalSaleTotals
  lines: MetalSaleLineInput[]
  tenders: Tender[]
  rates: RateMaps
}

export type PersistMetalSaleResult =
  | { ok: true; saleId: string; saleNumber: string; lineSnapshots: Record<string, unknown>[] }
  | { ok: false; error: 'sale_insert_failed' | 'sale_items_failed' | 'sale_payments_failed' }

/** Soft-delete a half-written sale so a failed step leaves no live row. */
async function withdraw(c: Client, tenantId: string, saleId: string, userId: string) {
  await c
    .from('sales')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
}

/**
 * Sale header + lines + tenders for a metal sale. Completed and locked at
 * insert — the counter collected the money already. Spot and the sell
 * multiplier are frozen per line from `rates`.
 */
export async function persistMetalSale(a: PersistMetalSaleArgs): Promise<PersistMetalSaleResult> {
  const now = new Date().toISOString()
  const { data: sale, error: saleErr } = await a.supabase
    .from('sales')
    .insert({
      tenant_id: a.tenantId,
      register_session_id: a.registerSessionId,
      sale_kind: 'metal',
      status: 'completed',
      customer_id: a.customerId,
      counterparty_name: a.counterpartyName,
      subtotal: a.totals.subtotal,
      tax_amount: a.totals.taxAmount,
      tax_rate: a.totals.taxRate,
      discount_amount: 0,
      total: a.totals.total,
      paid_total: a.totals.total,
      returned_total: 0,
      notes: a.notes,
      is_locked: true,
      completed_at: now,
      created_by: a.userId,
      updated_by: a.userId,
    })
    .select('id, sale_number')
    .single()
  if (saleErr || !sale) {
    console.error('[metal-sale] sale insert failed', saleErr?.message)
    return { ok: false, error: 'sale_insert_failed' }
  }

  const lineSnapshots: Record<string, unknown>[] = []
  const itemRows = a.lines.map((l, i) => {
    const rate = resolveRate(a.rates, l.metal, l.purity, 'sell')
    const snap = {
      metal: l.metal,
      purity: l.purity,
      weight_grams: r4(l.weight_grams),
      price: r4(l.price),
      spot_per_gram: rate.spotPerGram,
      rate_multiplier: rate.multiplier,
      sell_rate_configured: rate.configured,
      inventory_item_id: l.inventory_item_id,
    }
    lineSnapshots.push(snap)
    return {
      sale_id: sale.id,
      tenant_id: a.tenantId,
      inventory_item_id: l.inventory_item_id,
      description: l.description,
      quantity: 1,
      unit_price: snap.price,
      line_discount: 0,
      line_total: snap.price,
      position: i,
      returned_qty: 0,
      metal_type: l.metal,
      purity: l.purity,
      weight_grams: snap.weight_grams,
      spot_per_gram: rate.spotPerGram,
      rate_multiplier: rate.multiplier,
    }
  })
  const { error: itemsErr } = await a.supabase.from('sale_items').insert(itemRows)
  if (itemsErr) {
    console.error('[metal-sale] sale_items insert failed', itemsErr.message)
    await withdraw(a.supabase, a.tenantId, sale.id, a.userId)
    return { ok: false, error: 'sale_items_failed' }
  }

  const { error: payErr } = await a.supabase.from('sale_payments').insert(
    a.tenders.map((t) => ({
      sale_id: sale.id,
      tenant_id: a.tenantId,
      amount: t.amount,
      payment_method: t.method,
      card_present_status: 'not_used' as const,
      performed_by: a.userId,
      occurred_at: now,
    })),
  )
  if (payErr) {
    console.error('[metal-sale] sale_payments insert failed', payErr.message)
    await withdraw(a.supabase, a.tenantId, sale.id, a.userId)
    return { ok: false, error: 'sale_payments_failed' }
  }

  // Linked stock leaves the shelf.
  for (const l of a.lines) {
    if (!l.inventory_item_id) continue
    await a.supabase
      .from('inventory_items')
      .update({ status: 'sold', updated_by: a.userId })
      .eq('id', l.inventory_item_id)
      .eq('tenant_id', a.tenantId)
      .eq('status', 'available')
  }

  return { ok: true, saleId: sale.id, saleNumber: sale.sale_number ?? '', lineSnapshots }
}
