import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import PawnContent, { type PawnListRow } from './content'
import type { LoanStatus } from '@/types/database-aliases'
import { todayDateString, addDaysIso } from '@/lib/pawn/math'

type SearchParams = Promise<{
  q?: string
  status?: string
  due?: string
  customer?: string
}>

const NON_TERMINAL_STATUSES: ReadonlyArray<LoanStatus> = [
  'active',
  'extended',
  'partial_paid',
]

export default async function PawnListPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const statusFilter = (params.status ?? 'active') as LoanStatus | 'all' | 'dueSoon'
  const dueWindow = (params.due ?? 'all') as
    | 'all'
    | 'overdue'
    | 'dueSoon7'
    | 'dueSoon14'
  const customerFilter = (params.customer ?? '').trim()

  const today = todayDateString()
  const in7 = addDaysIso(today, 7)
  const in14 = addDaysIso(today, 14)

  // Embedded select pulls customer name in one round-trip.
  let query = ctx.supabase
    .from('loans')
    .select(
      `id, ticket_number, customer_id, principal, interest_rate_monthly,
       term_days, issue_date, due_date, status, is_printed, created_at,
       customer:customers(id, first_name, last_name, phone)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  // Status filter — special "active" pseudostatus = active|extended|partial_paid.
  if (statusFilter === 'active') {
    query = query.in('status', NON_TERMINAL_STATUSES)
  } else if (
    statusFilter === 'redeemed' ||
    statusFilter === 'forfeited' ||
    statusFilter === 'voided' ||
    statusFilter === 'extended' ||
    statusFilter === 'partial_paid'
  ) {
    query = query.eq('status', statusFilter)
  }
  // 'all' / 'dueSoon' fall through to no .eq() and rely on dueWindow.

  // Due-date window filter.
  if (dueWindow === 'overdue') {
    query = query.lt('due_date', today).in('status', NON_TERMINAL_STATUSES)
  } else if (dueWindow === 'dueSoon7') {
    query = query
      .gte('due_date', today)
      .lte('due_date', in7)
      .in('status', NON_TERMINAL_STATUSES)
  } else if (dueWindow === 'dueSoon14') {
    query = query
      .gte('due_date', today)
      .lte('due_date', in14)
      .in('status', NON_TERMINAL_STATUSES)
  }

  if (customerFilter) {
    query = query.eq('customer_id', customerFilter)
  }

  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(`ticket_number.ilike.%${escaped}%`)
  }

  const { data: loans } = await query

  // Status counts (parallel) for the filter chips.
  const [
    { count: countActive },
    { count: countOverdue },
    { count: countDueSoon7 },
    { count: countRedeemed },
    { count: countForfeited },
    { count: countVoided },
  ] = await Promise.all([
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .lt('due_date', today),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .gte('due_date', today)
      .lte('due_date', in7),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'redeemed'),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'forfeited'),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'voided'),
  ])

  // Filter the list further by `q` against customer name (server-side text
  // search across embedded relation isn't trivial to express in PostgREST;
  // we filter in-memory for Phase 2 — list is capped at 200 anyway).
  let rows: PawnListRow[] = (loans ?? []).map((l) => {
    const c = (l as unknown as { customer: { first_name: string; last_name: string; phone: string | null } | null }).customer
    return {
      id: l.id,
      ticket_number: l.ticket_number ?? '',
      customer_id: l.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      customer_phone: c?.phone ?? null,
      principal: l.principal,
      interest_rate_monthly: l.interest_rate_monthly,
      term_days: l.term_days,
      issue_date: l.issue_date,
      due_date: l.due_date,
      status: l.status as LoanStatus,
      is_printed: l.is_printed,
      created_at: l.created_at,
    }
  })

  if (q) {
    const ql = q.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.ticket_number.toLowerCase().includes(ql) ||
        r.customer_name.toLowerCase().includes(ql),
    )
  }

  return (
    <PawnContent
      rows={rows}
      query={q}
      statusFilter={statusFilter}
      dueWindow={dueWindow}
      customerFilter={customerFilter}
      counts={{
        active: countActive ?? 0,
        overdue: countOverdue ?? 0,
        dueSoon7: countDueSoon7 ?? 0,
        redeemed: countRedeemed ?? 0,
        forfeited: countForfeited ?? 0,
        voided: countVoided ?? 0,
      }}
      today={today}
    />
  )
}
