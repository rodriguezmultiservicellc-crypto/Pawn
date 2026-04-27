import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import LayawayListContent, {
  type LayawayListRow,
} from './content'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import { toMoney } from '@/lib/pos/cart'
import type { LayawayStatus } from '@/types/database-aliases'

type SearchParams = Promise<{
  status?: string
  customer?: string
  due?: string
}>

export default async function LayawayListPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_retail) redirect('/dashboard')

  const params = await props.searchParams
  const statusFilter = (params.status ?? 'active') as LayawayStatus | 'all' | 'dueSoon'
  const customerFilter = (params.customer ?? '').trim()
  const dueWindow = (params.due ?? 'all') as 'all' | 'dueSoon7'

  const today = todayDateString()
  const in7 = addDaysIso(today, 7)

  let q = ctx.supabase
    .from('layaways')
    .select(
      `id, layaway_number, customer_id, status, total_due, paid_total,
       balance_remaining, schedule_kind, first_payment_due, final_due_date,
       created_at,
       customer:customers(id, first_name, last_name, phone)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (
    statusFilter === 'active' ||
    statusFilter === 'completed' ||
    statusFilter === 'cancelled' ||
    statusFilter === 'defaulted'
  ) {
    q = q.eq('status', statusFilter)
  }
  if (customerFilter) q = q.eq('customer_id', customerFilter)
  if (dueWindow === 'dueSoon7') {
    q = q
      .eq('status', 'active')
      .gte('first_payment_due', today)
      .lte('first_payment_due', in7)
  }

  const { data: rows } = await q

  const list: LayawayListRow[] = (rows ?? []).map((l) => {
    const c = (l as unknown as {
      customer: {
        id: string
        first_name: string
        last_name: string
        phone: string | null
      } | null
    }).customer
    return {
      id: l.id,
      layaway_number: l.layaway_number ?? '',
      customer_id: l.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      status: l.status as LayawayStatus,
      total_due: toMoney(l.total_due),
      paid_total: toMoney(l.paid_total),
      balance_remaining: toMoney(l.balance_remaining),
      first_payment_due: l.first_payment_due,
      final_due_date: l.final_due_date,
      created_at: l.created_at,
    }
  })

  return (
    <LayawayListContent
      rows={list}
      statusFilter={statusFilter}
      dueWindow={dueWindow}
      customerFilter={customerFilter}
    />
  )
}
