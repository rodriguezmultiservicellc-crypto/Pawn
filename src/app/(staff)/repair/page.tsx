import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import RepairContent, { type RepairListRow } from './content'
import type {
  RepairStatus,
  ServiceType,
} from '@/types/database-aliases'

type SearchParams = Promise<{
  q?: string
  status?: string
  due?: string
  customer?: string
  serviceType?: string
  assignedTo?: string
  showAll?: string
}>

const NON_TERMINAL_STATUSES: ReadonlyArray<RepairStatus> = [
  'intake',
  'quoted',
  'awaiting_approval',
  // patches/0023 added 'assigned' (routed but not claimed) and 'tech_qa'
  // (final QA pass) — both belong in the active queue.
  'assigned',
  'in_progress',
  'needs_parts',
  'tech_qa',
  'ready',
]

export default async function RepairListPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const statusFilter = (params.status ?? 'active') as RepairStatus | 'all' | 'active'
  const dueWindow = (params.due ?? 'all') as
    | 'all'
    | 'overdue'
    | 'dueSoon7'
  const customerFilter = (params.customer ?? '').trim()
  const serviceTypeFilter = (params.serviceType ?? '') as ServiceType | ''
  const showAll = params.showAll === '1'

  // Tech inbox auto-filter: when a repair_tech opens the list and hasn't
  // explicitly asked for the full board, default to "my tickets" so the
  // first thing they see is the queue they're accountable for. Manager+
  // roles see everything by default — they're routing work, not doing it.
  let assignedToFilter = (params.assignedTo ?? '').trim()
  const isTech = ctx.tenantRole === 'repair_tech'
  if (isTech && !assignedToFilter && !showAll) {
    assignedToFilter = ctx.userId
  }

  const today = todayDateString()
  const in7 = addDaysIso(today, 7)

  let query = ctx.supabase
    .from('repair_tickets')
    .select(
      `id, ticket_number, customer_id, service_type, title, promised_date, status,
       quote_amount, deposit_amount, balance_due, paid_amount,
       assigned_to, is_locked, created_at, updated_at,
       customer:customers(id, first_name, last_name, phone)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (statusFilter === 'active') {
    query = query.in('status', NON_TERMINAL_STATUSES)
  } else if (
    statusFilter === 'intake' ||
    statusFilter === 'quoted' ||
    statusFilter === 'awaiting_approval' ||
    statusFilter === 'assigned' ||
    statusFilter === 'in_progress' ||
    statusFilter === 'needs_parts' ||
    statusFilter === 'tech_qa' ||
    statusFilter === 'ready' ||
    statusFilter === 'picked_up' ||
    statusFilter === 'abandoned' ||
    statusFilter === 'voided'
  ) {
    query = query.eq('status', statusFilter)
  }

  if (dueWindow === 'overdue') {
    query = query
      .lt('promised_date', today)
      .in('status', NON_TERMINAL_STATUSES)
  } else if (dueWindow === 'dueSoon7') {
    query = query
      .gte('promised_date', today)
      .lte('promised_date', in7)
      .in('status', NON_TERMINAL_STATUSES)
  }

  if (customerFilter) query = query.eq('customer_id', customerFilter)
  if (serviceTypeFilter) query = query.eq('service_type', serviceTypeFilter)
  if (assignedToFilter) query = query.eq('assigned_to', assignedToFilter)

  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(
      `ticket_number.ilike.%${escaped}%,title.ilike.%${escaped}%`,
    )
  }

  const { data: tickets } = await query

  const [
    { count: countActive },
    { count: countOverdue },
    { count: countDueSoon7 },
    { count: countReady },
    { count: countPickedUp },
    { count: countAbandoned },
    { count: countVoided },
  ] = await Promise.all([
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES),
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .lt('promised_date', today),
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .gte('promised_date', today)
      .lte('promised_date', in7),
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'ready'),
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'picked_up'),
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'abandoned'),
    ctx.supabase
      .from('repair_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'voided'),
  ])

  // Resolve assignee names from profiles in one batch.
  const assigneeIds = Array.from(
    new Set(
      (tickets ?? [])
        .map((t) => t.assigned_to)
        .filter((v): v is string => !!v),
    ),
  )
  let assigneeNames: Record<string, string> = {}
  if (assigneeIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', assigneeIds)
    assigneeNames = Object.fromEntries(
      (profiles ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.email || p.id.slice(0, 8),
      ]),
    )
  }

  let rows: RepairListRow[] = (tickets ?? []).map((t) => {
    const c = (t as unknown as {
      customer: {
        id: string
        first_name: string
        last_name: string
        phone: string | null
      } | null
    }).customer
    return {
      id: t.id,
      ticket_number: t.ticket_number ?? '',
      customer_id: t.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      customer_phone: c?.phone ?? null,
      service_type: t.service_type,
      title: t.title,
      promised_date: t.promised_date,
      status: t.status,
      quote_amount: t.quote_amount == null ? null : Number(t.quote_amount),
      balance_due: t.balance_due == null ? null : Number(t.balance_due),
      assigned_to: t.assigned_to,
      assigned_to_name: t.assigned_to ? assigneeNames[t.assigned_to] ?? null : null,
      is_locked: t.is_locked,
      created_at: t.created_at,
    }
  })

  if (q) {
    const ql = q.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.ticket_number.toLowerCase().includes(ql) ||
        r.title.toLowerCase().includes(ql) ||
        r.customer_name.toLowerCase().includes(ql),
    )
  }

  return (
    <RepairContent
      rows={rows}
      query={q}
      statusFilter={statusFilter}
      dueWindow={dueWindow}
      customerFilter={customerFilter}
      serviceTypeFilter={serviceTypeFilter}
      assignedToFilter={assignedToFilter}
      counts={{
        active: countActive ?? 0,
        overdue: countOverdue ?? 0,
        dueSoon7: countDueSoon7 ?? 0,
        ready: countReady ?? 0,
        pickedUp: countPickedUp ?? 0,
        abandoned: countAbandoned ?? 0,
        voided: countVoided ?? 0,
      }}
      today={today}
    />
  )
}
