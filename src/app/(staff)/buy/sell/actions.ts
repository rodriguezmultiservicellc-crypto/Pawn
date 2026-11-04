'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { metalSaleSchema } from '@/lib/validations/metal-sale'
import { checkStaleSpotGate } from '@/lib/spot-prices/stale-gate'
import { loadRateMaps } from '@/lib/metal-counter/rates'
import { splitTenders, sumDollars, sumGrams } from '@/lib/metal-counter/math'
import { r4 } from '@/lib/pos/cart'
import { persistMetalSale } from './persist'

export type CreateMetalSaleState = {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

const STAFF_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const
const ECHO_KEYS = [
  'customer_id',
  'counterparty_name',
  'payment_method',
  'paid_cash',
  'paid_transfer',
  'tax_pct',
  'notes',
] as const

function readLines(fd: FormData) {
  const count = Math.max(0, Math.min(60, parseInt(String(fd.get('line_count') ?? '0'), 10) || 0))
  return Array.from({ length: count }, (_, i) => ({
    description: fd.get(`line_${i}_description`),
    metal: fd.get(`line_${i}_metal`),
    purity: fd.get(`line_${i}_purity`),
    weight_grams: fd.get(`line_${i}_weight_grams`),
    price: fd.get(`line_${i}_price`),
    inventory_item_id: fd.get(`line_${i}_inventory_item_id`),
    position: String(i),
  }))
}

/**
 * Sell scrap / bullion (brief Phase 3). Gate → validate → recompute money
 * → tenders → stale-spot guard → buyer + stock checks → persist (see
 * ./persist.ts) → audit. No compliance_log row: selling shop-owned metal
 * is not a reportable acquisition. Line prices are the operator's
 * (negotiable); spot and the sell multiplier are frozen beside them.
 */
export async function createMetalSaleAction(
  _prev: CreateMetalSaleState,
  formData: FormData,
): Promise<CreateMetalSaleState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant || (!tenant.has_pawn && !tenant.has_retail)) redirect('/dashboard')

  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, STAFF_ROLES)
  const tenantId = ctx.tenantId

  const echo: Record<string, string> = {}
  for (const k of ECHO_KEYS) {
    const v = formData.get(k)
    echo[k] = typeof v === 'string' ? v : ''
  }

  const parsed = metalSaleSchema.safeParse({
    customer_id: formData.get('customer_id'),
    counterparty_name: formData.get('counterparty_name'),
    tax_rate: formData.get('tax_rate'),
    payment_method: formData.get('payment_method'),
    paid_cash: formData.get('paid_cash'),
    paid_transfer: formData.get('paid_transfer'),
    notes: formData.get('notes'),
    lines: readLines(formData),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors, values: echo }
  }
  const v = parsed.data

  const subtotal = sumDollars(v.lines.map((l) => ({ dollars: r4(l.price) })))
  const taxAmount = r4(subtotal * v.tax_rate)
  const total = r4(subtotal + taxAmount)

  const split = splitTenders({
    method: v.payment_method,
    total,
    cash: v.paid_cash,
    transfer: v.paid_transfer,
  })
  if (!split.ok) return { error: split.error, values: echo }

  const staleGate = await checkStaleSpotGate({
    formData,
    tenantRole: ctx.tenantRole,
    involvesMetal: true,
  })
  if (!staleGate.ok) return { error: staleGate.error, values: echo }

  if (v.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('id', v.customer_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!customer) return { error: 'customer_not_found', values: echo }
  }

  const linkedIds = v.lines.map((l) => l.inventory_item_id).filter((x): x is string => !!x)
  if (linkedIds.length > 0) {
    const { data: rows } = await supabase
      .from('inventory_items')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .in('id', linkedIds)
    const ok = new Set((rows ?? []).filter((r) => r.status === 'available').map((r) => r.id))
    if (linkedIds.some((id) => !ok.has(id))) {
      return { error: 'inventory_not_available', values: echo }
    }
  }

  const [{ data: openSession }, rates] = await Promise.all([
    supabase
      .from('register_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .maybeSingle(),
    loadRateMaps(tenantId),
  ])

  const saved = await persistMetalSale({
    supabase,
    tenantId,
    userId,
    registerSessionId: openSession?.id ?? null,
    customerId: v.customer_id,
    counterpartyName: v.counterparty_name,
    notes: v.notes,
    totals: { subtotal, taxRate: v.tax_rate, taxAmount, total },
    lines: v.lines,
    tenders: split.tenders,
    rates,
  })
  if (!saved.ok) return { error: saved.error, values: echo }

  await logAudit({
    tenantId,
    userId,
    action: 'metal_sale_create',
    tableName: 'sales',
    recordId: saved.saleId,
    changes: {
      flow: 'metal_sale',
      sale_number: saved.saleNumber,
      customer_id: v.customer_id,
      counterparty_name: v.counterparty_name,
      register_session_id: openSession?.id ?? null,
      subtotal,
      tax_rate: v.tax_rate,
      tax_amount: taxAmount,
      total,
      total_grams: sumGrams(v.lines.map((l) => ({ grams: l.weight_grams }))),
      line_count: v.lines.length,
      lines: saved.lineSnapshots,
      tenders: split.tenders,
      notes: v.notes,
      stale_spot_ack: staleGate.acknowledged
        ? {
            confirmed_by: userId,
            spot_fetched_at: staleGate.freshness.newestFetchedAt,
            spot_age_hours: staleGate.freshness.ageHours,
          }
        : null,
    },
  })

  revalidatePath('/pos')
  revalidatePath('/inventory')
  revalidatePath('/buy/sell')
  redirect(`/buy/sell/${saved.saleId}`)
}
