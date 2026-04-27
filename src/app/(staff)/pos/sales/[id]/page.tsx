import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import SaleDetailContent, {
  type SaleDetailItem,
  type SaleDetailPayment,
  type SaleDetailView,
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

  const { data: sale } = await ctx.supabase
    .from('sales')
    .select(
      `id, tenant_id, sale_number, sale_kind, status, customer_id,
       subtotal, tax_amount, tax_rate, discount_amount, total, paid_total,
       returned_total, notes, is_locked, completed_at, created_at, updated_at,
       customer:customers(id, first_name, last_name, phone, email)`,
    )
    .eq('id', id)
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

  return (
    <SaleDetailContent
      sale={view}
      items={items}
      payments={payments}
      layawayId={layawayId}
    />
  )
}
