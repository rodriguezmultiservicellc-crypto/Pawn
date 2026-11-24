import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import PosHomeContent, {
  type PosHomeOpenSession,
  type PosHomeRecentSale,
} from './content'
import type { SaleKind, SaleStatus } from '@/types/database-aliases'
import { r4, toMoney } from '@/lib/pos/cart'
import { expectedDrawerCash, loadDrawerCash } from '@/lib/pos/drawer-cash'

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

  // The open drawer: every cash movement of the shop since it opened (the
  // same loadDrawerCash the close uses), and card sales beside it.
  let openSessionView: PosHomeOpenSession | null = null
  if (session) {
    const openedAt = session.opened_at
    const [cash, { data: cardPays }] = await Promise.all([
      loadDrawerCash({ supabase: ctx.supabase, tenantId: ctx.tenantId, from: openedAt, to: null }),
      ctx.supabase
        .from('sale_payments')
        .select('amount')
        .eq('tenant_id', ctx.tenantId)
        .eq('payment_method', 'card')
        .gte('occurred_at', openedAt)
        .is('deleted_at', null),
    ])
    let cardSales = 0
    for (const p of cardPays ?? []) cardSales = r4(cardSales + toMoney(p.amount))

    openSessionView = {
      id: session.id,
      opened_at: session.opened_at,
      opened_by: session.opened_by,
      opening_cash: toMoney(session.opening_cash),
      card_sales: cardSales,
      cash,
      expected_cash: expectedDrawerCash(session.opening_cash, cash),
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
      sale_kind: (s.sale_kind ?? 'retail') as SaleKind,
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
