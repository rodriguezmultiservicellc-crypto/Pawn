import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import LayawayDetailContent, {
  type LayawayDetailItem,
  type LayawayDetailPayment,
  type LayawayDetailView,
} from './content'
import { toMoney } from '@/lib/pos/cart'
import type {
  LayawayScheduleKind,
  LayawayStatus,
  PaymentMethod,
} from '@/types/database-aliases'

type Params = Promise<{ id: string }>

export default async function LayawayDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: lay } = await ctx.supabase
    .from('layaways')
    .select(
      `id, tenant_id, sale_id, layaway_number, customer_id, status,
       total_due, paid_total, balance_remaining, schedule_kind,
       down_payment, first_payment_due, final_due_date,
       cancellation_fee_pct, cancelled_at, completed_at, notes, created_at,
       customer:customers(id, first_name, last_name, phone, email)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!lay) redirect('/pos/layaways')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', lay.tenant_id)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/dashboard')

  const [{ data: itemRows }, { data: payRows }] = await Promise.all([
    ctx.supabase
      .from('sale_items')
      .select(
        'id, inventory_item_id, description, quantity, unit_price, line_total, position',
      )
      .eq('sale_id', lay.sale_id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    ctx.supabase
      .from('layaway_payments')
      .select(
        'id, amount, payment_method, card_present_status, notes, occurred_at',
      )
      .eq('layaway_id', lay.id)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false }),
  ])

  const items: LayawayDetailItem[] = (itemRows ?? []).map((it) => ({
    id: it.id,
    inventory_item_id: it.inventory_item_id,
    description: it.description,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    line_total: Number(it.line_total ?? 0),
  }))

  const payments: LayawayDetailPayment[] = (payRows ?? []).map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    payment_method: p.payment_method as PaymentMethod,
    notes: p.notes,
    occurred_at: p.occurred_at,
  }))

  const c = (lay as unknown as {
    customer: {
      id: string
      first_name: string
      last_name: string
      phone: string | null
      email: string | null
    } | null
  }).customer

  const view: LayawayDetailView = {
    id: lay.id,
    tenant_id: lay.tenant_id,
    sale_id: lay.sale_id,
    layaway_number: lay.layaway_number ?? '',
    status: lay.status as LayawayStatus,
    customer_id: lay.customer_id,
    customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
    customer_phone: c?.phone ?? null,
    total_due: toMoney(lay.total_due),
    paid_total: toMoney(lay.paid_total),
    balance_remaining: toMoney(lay.balance_remaining),
    down_payment: toMoney(lay.down_payment),
    schedule_kind: lay.schedule_kind as LayawayScheduleKind,
    first_payment_due: lay.first_payment_due,
    final_due_date: lay.final_due_date,
    cancellation_fee_pct: toMoney(lay.cancellation_fee_pct),
    cancelled_at: lay.cancelled_at,
    completed_at: lay.completed_at,
    notes: lay.notes,
    created_at: lay.created_at,
  }

  return (
    <LayawayDetailContent
      layaway={view}
      items={items}
      payments={payments}
    />
  )
}
