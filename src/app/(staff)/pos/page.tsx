import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import PosHomeContent, {
  type PosHomeOpenSession,
  type PosHomeRecentSale,
} from './content'
import type { SaleStatus } from '@/types/database-aliases'
import { r4, toMoney } from '@/lib/pos/cart'
import { expectedCash } from '@/lib/pos/register'

export default async function PosHomePage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/dashboard')

  // Find the open register session for the active tenant (if any).
  const { data: session } = await ctx.supabase
    .from('register_sessions')
    .select(
      'id, status, opened_at, opened_by, opening_cash, notes, closed_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .maybeSingle()

  // Today's sales — last 25.
  const { data: salesRows } = await ctx.supabase
    .from('sales')
    .select(
      `id, sale_number, sale_kind, status, total, paid_total, completed_at,
       created_at, customer_id,
       customer:customers(id, first_name, last_name)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(25)

  // Aggregate cash + card sale_payments since session opened.
  let cashSales = 0
  let cardSales = 0
  let cashRefunds = 0
  let openSessionView: PosHomeOpenSession | null = null
  if (session) {
    const openedAt = session.opened_at
    const [{ data: pays }, { data: returns }] = await Promise.all([
      ctx.supabase
        .from('sale_payments')
        .select('amount, payment_method')
        .eq('tenant_id', ctx.tenantId)
        .gte('occurred_at', openedAt)
        .is('deleted_at', null),
      ctx.supabase
        .from('returns')
        .select('total, refund_method')
        .eq('tenant_id', ctx.tenantId)
        .gte('created_at', openedAt)
        .is('deleted_at', null),
    ])
    for (const p of pays ?? []) {
      const amt = toMoney(p.amount)
      if (p.payment_method === 'cash') cashSales = r4(cashSales + amt)
      else if (p.payment_method === 'card') cardSales = r4(cardSales + amt)
    }
    for (const r of returns ?? []) {
      if (r.refund_method === 'cash') cashRefunds = r4(cashRefunds + toMoney(r.total))
    }

    const expected = expectedCash({
      opening_cash: session.opening_cash,
      cash_payments: cashSales,
      cash_refunds: cashRefunds,
    })
    openSessionView = {
      id: session.id,
      opened_at: session.opened_at,
      opened_by: session.opened_by,
      opening_cash: toMoney(session.opening_cash),
      cash_sales: cashSales,
      card_sales: cardSales,
      cash_refunds: cashRefunds,
      expected_cash: expected,
      notes: session.notes,
    }
  }

  const recent: PosHomeRecentSale[] = (salesRows ?? []).map((s) => {
    const c = (s as unknown as {
      customer: { id: string; first_name: string; last_name: string } | null
    }).customer
    return {
      id: s.id,
      sale_number: s.sale_number ?? '',
      sale_kind: (s.sale_kind ?? 'retail') as 'retail' | 'layaway',
      status: s.status as SaleStatus,
      total: toMoney(s.total),
      paid_total: toMoney(s.paid_total),
      completed_at: s.completed_at,
      created_at: s.created_at,
      customer_id: s.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : null,
    }
  })

  return (
    <PosHomeContent
      openSession={openSessionView}
      recentSales={recent}
    />
  )
}
