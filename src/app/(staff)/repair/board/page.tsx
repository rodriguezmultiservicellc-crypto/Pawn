import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { todayDateString } from '@/lib/pawn/math'
import BoardContent, { type BoardCard, type TechOption } from './content'
import type {
  RepairStatus,
  ServiceType,
  TenantRole,
} from '@/types/database-aliases'

const SERVICE_TYPE_VALUES: ReadonlyArray<ServiceType> = [
  'repair',
  'stone_setting',
  'sizing',
  'restring',
  'plating',
  'engraving',
  'custom',
]

type SearchParams = Promise<{
  tech?: string
  serviceType?: string
}>

const MANAGER_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'chain_admin',
]

/**
 * Status columns shown on the board. Order mirrors the workflow lane:
 * routed → working → blocked → QA → done-but-not-picked-up. Terminal
 * states (picked_up / abandoned / voided) are excluded — the board is
 * a work-in-progress view, not a historical archive. The list page
 * remains the surface for terminal filtering.
 */
const BOARD_COLUMNS: ReadonlyArray<RepairStatus> = [
  'assigned',
  'in_progress',
  'needs_parts',
  'tech_qa',
  'ready',
]

export default async function RepairBoardPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate: same as /repair list.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  // Manager-only — bounce techs / pawn_clerks back to the regular list,
  // not /no-tenant. They keep their normal access; just no board view.
  if (!ctx.tenantRole || !MANAGER_ROLES.includes(ctx.tenantRole)) {
    redirect('/repair')
  }

  const params = await props.searchParams
  const techFilter = (params.tech ?? '').trim()
  const serviceTypeFilter = (params.serviceType ?? '').trim()

  let query = ctx.supabase
    .from('repair_tickets')
    .select(
      `id, ticket_number, customer_id, service_type, title, promised_date,
       status, assigned_to, balance_due, created_at,
       customer:customers(first_name, last_name)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .in('status', BOARD_COLUMNS)
    // Sort within each column by promised_date ascending, NULLS last,
    // then by created_at so the oldest-promised card sits at top.
    .order('promised_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(500)

  if (techFilter) {
    if (techFilter === 'unassigned') {
      query = query.is('assigned_to', null)
    } else {
      query = query.eq('assigned_to', techFilter)
    }
  }
  if (
    serviceTypeFilter &&
    SERVICE_TYPE_VALUES.includes(serviceTypeFilter as ServiceType)
  ) {
    query = query.eq('service_type', serviceTypeFilter as ServiceType)
  }

  const { data: tickets } = await query

  // Resolve assignee names + build the tech filter chip strip. We pull
  // EVERY active staff member (not just those currently assigned) so the
  // chip strip stays stable as work moves around. Excludes 'client' and
  // anyone deactivated.
  const { data: staffRows } = await ctx.supabase
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)
    .neq('role', 'client')

  const staffIds = Array.from(
    new Set((staffRows ?? []).map((r) => r.user_id).filter((v): v is string => !!v)),
  )
  let staffNames: Record<string, string> = {}
  if (staffIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', staffIds)
    staffNames = Object.fromEntries(
      (profiles ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.email || p.id.slice(0, 8),
      ]),
    )
  }

  // Count cards per tech (only across the currently-loaded set, after
  // serviceType filter — so the chip count reflects the visible board).
  const ticketsByTech: Record<string, number> = {}
  let unassignedCount = 0
  for (const row of tickets ?? []) {
    if (!row.assigned_to) {
      unassignedCount += 1
    } else {
      ticketsByTech[row.assigned_to] = (ticketsByTech[row.assigned_to] ?? 0) + 1
    }
  }

  const techOptions: TechOption[] = staffIds.map((id) => ({
    id,
    name: staffNames[id] ?? id.slice(0, 8),
    activeCount: ticketsByTech[id] ?? 0,
  }))
  // Sort: active-count desc, then alphabetic. Drops idle staff to the end.
  techOptions.sort((a, b) =>
    b.activeCount !== a.activeCount
      ? b.activeCount - a.activeCount
      : a.name.localeCompare(b.name),
  )

  const cards: BoardCard[] = (tickets ?? []).map((t) => {
    const c = (t as unknown as {
      customer: { first_name: string; last_name: string } | null
    }).customer
    return {
      id: t.id,
      ticket_number: t.ticket_number ?? '',
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      service_type: t.service_type,
      title: t.title,
      promised_date: t.promised_date,
      status: t.status,
      assigned_to: t.assigned_to,
      assigned_to_name: t.assigned_to
        ? staffNames[t.assigned_to] ?? null
        : null,
      balance_due: t.balance_due == null ? null : Number(t.balance_due),
      created_at: t.created_at,
    }
  })

  // Group cards by status for the columns.
  const cardsByStatus: Record<RepairStatus, BoardCard[]> = {
    intake: [],
    quoted: [],
    awaiting_approval: [],
    assigned: [],
    in_progress: [],
    needs_parts: [],
    tech_qa: [],
    ready: [],
    picked_up: [],
    abandoned: [],
    voided: [],
  }
  for (const c of cards) {
    cardsByStatus[c.status].push(c)
  }

  return (
    <BoardContent
      columns={BOARD_COLUMNS}
      cardsByStatus={cardsByStatus}
      techOptions={techOptions}
      techFilter={techFilter}
      unassignedCount={unassignedCount}
      serviceTypeFilter={serviceTypeFilter}
      today={todayDateString()}
    />
  )
}
