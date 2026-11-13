import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import OnlineOrdersContent, { type OrderRow, type OrderTab } from './content'

export const dynamic = 'force-dynamic'

const STAFF = new Set(['owner', 'chain_admin', 'manager', 'pawn_clerk'])
const TAB_STATUSES: Record<OrderTab, string[] | null> = {
  action: ['paid', 'picking', 'ready', 'shipped'],
  refund: ['needs_refund'],
  done: ['completed'],
  all: null,
}

/** /pos/online-orders — the staff queue for orders paid on the website. */
export default async function OnlineOrdersPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !STAFF.has(ctx.tenantRole)) redirect('/dashboard')

  const sp = await props.searchParams
  const tab: OrderTab = sp.tab === 'refund' || sp.tab === 'done' || sp.tab === 'all' ? sp.tab : 'action'

  let q = ctx.supabase
    .from('online_orders')
    .select('id, order_number, contact_name, fulfillment, total, status, paid_at, created_at')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .limit(200)
  const statuses = TAB_STATUSES[tab]
  // "All" still hides abandoned checkouts nobody paid for.
  q = statuses ? q.in('status', statuses) : q.not('status', 'in', '(pending_payment,expired,cancelled)')
  const { data } = await q

  const rows: OrderRow[] = (data ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    customer: o.contact_name,
    fulfillment: o.fulfillment as 'pickup' | 'ship',
    total: Number(o.total),
    status: o.status,
    paidAt: o.paid_at,
  }))
  return <OnlineOrdersContent rows={rows} tab={tab} />
}
