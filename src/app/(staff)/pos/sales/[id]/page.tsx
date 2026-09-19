import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import SaleDetailContent, {
  type SaleDetailItem,
  type SaleDetailPayment,
  type SaleDetailView,
  type SaleDetailLoyalty,
  type SaleDetailStoreCredit,
} from './content'
import { computeBalance, toMoney } from '@/lib/pos/cart'
import type {
  CardPresentStatus,
  PaymentMethod,
  SaleKind,
  SaleStatus,
} from '@/types/database-aliases'

type Params = Promise<{ id: string }>

export default async function SaleDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      `id, tenant_id, sale_number, sale_kind, status, customer_id,
       subtotal, tax_amount, tax_rate, discount_amount, total, paid_total,
       returned_total, notes, is_locked, completed_at, created_at, updated_at,
       customer:customers(id, first_name, last_name, phone, email)`,
    )
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!sale) redirect('/pos')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', sale.tenant_id)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/dashboard')

  const [{ data: itemRows }, { data: payRows }] = await Promise.all([
    ctx.supabase
      .from('sale_items')
      .select(
        'id, inventory_item_id, description, quantity, unit_price, line_discount, line_total, position, returned_qty',
      )
      .eq('sale_id', id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    ctx.supabase
      .from('sale_payments')
      .select(
        'id, amount, payment_method, card_present_status, stripe_payment_intent_id, reader_id, notes, occurred_at',
      )
      .eq('sale_id', id)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false }),
  ])

  const items: SaleDetailItem[] = (itemRows ?? []).map((it) => ({
    id: it.id,
    inventory_item_id: it.inventory_item_id,
    description: it.description,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    line_discount: Number(it.line_discount ?? 0),
    line_total: Number(it.line_total ?? 0),
    position: it.position,
    returned_qty: Number(it.returned_qty ?? 0),
  }))

  const payments: SaleDetailPayment[] = (payRows ?? []).map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    payment_method: p.payment_method as PaymentMethod,
    card_present_status: (p.card_present_status ??
      'not_used') as CardPresentStatus,
    stripe_payment_intent_id: p.stripe_payment_intent_id,
    reader_id: p.reader_id,
    notes: p.notes,
    occurred_at: p.occurred_at,
  }))

  const c = (sale as unknown as {
    customer: {
      id: string
      first_name: string
      last_name: string
      phone: string | null
      email: string | null
    } | null
  }).customer

  const view: SaleDetailView = {
    id: sale.id,
    tenant_id: sale.tenant_id,
    sale_number: sale.sale_number ?? '',
    sale_kind: sale.sale_kind as SaleKind,
    status: sale.status as SaleStatus,
    customer_id: sale.customer_id,
    customer_name: c ? `${c.last_name}, ${c.first_name}` : null,
    customer_phone: c?.phone ?? null,
    customer_email: c?.email ?? null,
    subtotal: toMoney(sale.subtotal),
    tax_amount: toMoney(sale.tax_amount),
    tax_rate: toMoney(sale.tax_rate),
    discount_amount: toMoney(sale.discount_amount),
    total: toMoney(sale.total),
    paid_total: toMoney(sale.paid_total),
    returned_total: toMoney(sale.returned_total),
    balance: computeBalance({
      total: sale.total,
      paid_total: sale.paid_total,
    }),
    notes: sale.notes,
    is_locked: sale.is_locked,
    completed_at: sale.completed_at,
    created_at: sale.created_at,
  }

  // Pull the linked layaway, if any.
  let layawayId: string | null = null
  if (sale.sale_kind === 'layaway') {
    const { data: lay } = await ctx.supabase
      .from('layaways')
      .select('id')
      .eq('sale_id', sale.id)
      .is('deleted_at', null)
      .maybeSingle()
    layawayId = lay?.id ?? null
  }

  // Loyalty: settings + (if enabled and customer present) balance + redemptions.
  const adminClient = createAdminClient()
  const { data: posSettings } = await adminClient
    .from('settings')
    .select('loyalty_enabled, loyalty_redemption_rate')
    .eq('tenant_id', sale.tenant_id)
    .maybeSingle()
  const loyaltyEnabled = !!posSettings?.loyalty_enabled
  const redemptionRate = posSettings?.loyalty_redemption_rate
    ? Number(posSettings.loyalty_redemption_rate)
    : 100

  let customerBalance = 0
  let customerFirstName = ''
  let redemptionsOnThisSale: {
    id: string
    points_delta: number
    created_at: string
  }[] = []
  if (loyaltyEnabled && sale.customer_id) {
    const [{ data: cust }, { data: redeems }] = await Promise.all([
      adminClient
        .from('customers')
        .select('first_name, loyalty_points_balance')
        .eq('id', sale.customer_id)
        .maybeSingle(),
      adminClient
        .from('loyalty_events')
        .select('id, points_delta, created_at')
        .eq('source_kind', 'sale')
        .eq('source_id', sale.id)
        .eq('kind', 'redeem_pos')
        .order('created_at', { ascending: false }),
    ])
    customerBalance = cust?.loyalty_points_balance ?? 0
    customerFirstName = cust?.first_name ?? ''
    redemptionsOnThisSale = redeems ?? []
  }

  const loyalty: SaleDetailLoyalty = {
    enabled: loyaltyEnabled,
    customerFirstName,
    customerBalance,
    redemptionRate,
    redemptionsOnThisSale,
  }

  // Store credit (patches/0053). The redemptions on this sale are read even
  // when the module is off so a closed sale still shows how it was paid.
  const { data: scSettings } = await adminClient
    .from('settings')
    .select('store_credit_enabled')
    .eq('tenant_id', sale.tenant_id)
    .maybeSingle()

  let storeCreditBalance = 0
  let storeCreditFirstName = customerFirstName
  let storeCreditRedemptions: SaleDetailStoreCredit['redemptionsOnThisSale'] = []
  if (sale.customer_id) {
    const [{ data: cust }, { data: scRows }] = await Promise.all([
      adminClient
        .from('customers')
        .select('first_name, store_credit_balance')
        .eq('id', sale.customer_id)
        .maybeSingle(),
      adminClient
        .from('store_credit_events')
        .select('id, amount_delta, created_at')
        .eq('source_kind', 'sale')
        .eq('source_id', sale.id)
        .eq('kind', 'redeem_pos')
        .order('created_at', { ascending: false }),
    ])
    storeCreditBalance = toMoney(cust?.store_credit_balance)
    storeCreditFirstName = cust?.first_name ?? customerFirstName

    // An entry that has already been undone is spent history, not a
    // reversible tender — drop it so the sale doesn't offer "Undo" twice.
    const redeemIds = (scRows ?? []).map((r) => r.id)
    const undone = new Set<string>()
    if (redeemIds.length > 0) {
      const { data: undoRows } = await adminClient
        .from('store_credit_events')
        .select('source_id')
        .eq('kind', 'redeem_undo')
        .eq('source_kind', 'store_credit_event')
        .in('source_id', redeemIds)
      for (const u of undoRows ?? []) {
        if (u.source_id) undone.add(u.source_id)
      }
    }
    storeCreditRedemptions = (scRows ?? [])
      .filter((r) => !undone.has(r.id))
      .map((r) => ({
        id: r.id,
        amount: Math.abs(toMoney(r.amount_delta)),
        created_at: r.created_at,
      }))
  }

  const storeCredit: SaleDetailStoreCredit = {
    enabled: scSettings?.store_credit_enabled === true,
    customerFirstName: storeCreditFirstName,
    balance: storeCreditBalance,
    redemptionsOnThisSale: storeCreditRedemptions,
  }

  return (
    <SaleDetailContent
      sale={view}
      items={items}
      payments={payments}
      layawayId={layawayId}
      loyalty={loyalty}
      storeCredit={storeCredit}
    />
  )
}
