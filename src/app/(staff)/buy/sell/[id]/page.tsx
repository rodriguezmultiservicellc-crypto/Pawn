import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { toMoney } from '@/lib/pos/cart'
import MetalSaleReceiptContent, { type MetalSaleView } from './content'
import type { MetalPurity, MetalType, PaymentMethod } from '@/types/database-aliases'

/**
 * Metal-sale receipt (brief Phase 3). The sell action redirects here; the
 * page lives beside the counter (not under /pos) so a pawn-only shop
 * without the retail module can still see what it just sold.
 */
export default async function MetalSaleReceiptPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant || (!tenant.has_pawn && !tenant.has_retail)) redirect('/dashboard')

  await requireRoleInTenant(ctx.tenantId, ['owner', 'manager', 'pawn_clerk', 'chain_admin'])

  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      `id, sale_number, sale_kind, status, customer_id, counterparty_name,
       subtotal, tax_amount, tax_rate, total, paid_total, notes, completed_at, created_at,
       register_session_id,
       customer:customers(first_name, last_name)`,
    )
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale || sale.sale_kind !== 'metal') redirect('/buy/sell')

  const [{ data: items }, { data: payments }] = await Promise.all([
    ctx.supabase
      .from('sale_items')
      .select(
        'id, inventory_item_id, description, line_total, position, metal_type, purity, weight_grams, spot_per_gram, rate_multiplier',
      )
      .eq('sale_id', id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    ctx.supabase
      .from('sale_payments')
      .select('id, amount, payment_method, occurred_at')
      .eq('sale_id', id)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: true }),
  ])

  const c = (sale as unknown as { customer: { first_name: string; last_name: string } | null }).customer

  const view: MetalSaleView = {
    id: sale.id,
    saleNumber: sale.sale_number ?? '',
    status: sale.status,
    completedAt: sale.completed_at ?? sale.created_at,
    customerId: sale.customer_id,
    customerName: c ? `${c.first_name} ${c.last_name}`.trim() : null,
    counterpartyName: sale.counterparty_name,
    subtotal: toMoney(sale.subtotal),
    taxRate: toMoney(sale.tax_rate),
    taxAmount: toMoney(sale.tax_amount),
    total: toMoney(sale.total),
    notes: sale.notes,
    registerAttached: sale.register_session_id != null,
    hasRetail: !!tenant.has_retail,
    lines: (items ?? []).map((it) => ({
      id: it.id,
      inventoryItemId: it.inventory_item_id,
      description: it.description,
      metal: (it.metal_type as MetalType | null) ?? null,
      purity: (it.purity as MetalPurity | null) ?? null,
      grams: it.weight_grams == null ? null : Number(it.weight_grams),
      spotPerGram: it.spot_per_gram == null ? null : Number(it.spot_per_gram),
      rateMultiplier: it.rate_multiplier == null ? null : Number(it.rate_multiplier),
      price: toMoney(it.line_total),
    })),
    payments: (payments ?? []).map((p) => ({
      id: p.id,
      method: p.payment_method as PaymentMethod,
      amount: toMoney(p.amount),
      occurredAt: p.occurred_at,
    })),
  }

  return <MetalSaleReceiptContent view={view} />
}
