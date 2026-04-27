import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import AuditContent, { type AuditEvent, type FacetUser } from './content'

const PAGE_SIZE = 50
const FACET_SAMPLE_SIZE = 1000

type SearchParams = Promise<{
  q?: string
  user?: string
  table?: string
  actionPrefix?: string
  from?: string
  to?: string
  page?: string
}>

export default async function AuditPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Owners + managers + chain_admins (for HQ users browsing a child shop).
  // pawn_clerk / repair_tech / appraiser don't see this page.
  await requireRoleInTenant(ctx.tenantId, ['owner', 'manager', 'chain_admin'])

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const userFilter = (params.user ?? '').trim()
  const tableFilter = (params.table ?? '').trim()
  const actionPrefix = (params.actionPrefix ?? '').trim()
  const fromIso = (params.from ?? '').trim()
  const toIso = (params.to ?? '').trim()
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  const offset = (page - 1) * PAGE_SIZE

  const tenantId = ctx.tenantId

  // Defense-in-depth (Rule 8): always filter by tenant_id even though the
  // RLS staff_read policy already restricts to my_accessible_tenant_ids().
  let query = ctx.supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(
      `action.ilike.%${escaped}%,table_name.ilike.%${escaped}%`,
    )
  }
  if (userFilter) query = query.eq('user_id', userFilter)
  if (tableFilter) query = query.eq('table_name', tableFilter)
  if (actionPrefix) {
    // Match either the bare action ("create") or any future "prefix.*"
    // schema. We OR the equality check with a LIKE prefix so both work.
    const escaped = actionPrefix.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(`action.eq.${escaped},action.ilike.${escaped}.%`)
  }
  if (fromIso) query = query.gte('created_at', fromIso)
  if (toIso) {
    // Inclusive end-of-day: if the input is a bare date (YYYY-MM-DD), bump
    // to the next day so the range catches events later in the day.
    const end = /^\d{4}-\d{2}-\d{2}$/.test(toIso)
      ? new Date(`${toIso}T23:59:59.999Z`).toISOString()
      : toIso
    query = query.lte('created_at', end)
  }

  // Facets: distinct user_ids, table_names, and action prefixes seen in the
  // most recent FACET_SAMPLE_SIZE rows. In-memory dedupe keeps it cheap.
  const facetQuery = ctx.supabase
    .from('audit_log')
    .select('user_id, table_name, action')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(FACET_SAMPLE_SIZE)

  const [{ data: rows, count }, { data: facetRows }] = await Promise.all([
    query,
    facetQuery,
  ])

  const tables = new Set<string>()
  const actionPrefixes = new Set<string>()
  const userIdSet = new Set<string>()
  for (const r of facetRows ?? []) {
    if (r.table_name) tables.add(r.table_name)
    if (r.action) {
      const dot = r.action.indexOf('.')
      actionPrefixes.add(dot > 0 ? r.action.slice(0, dot) : r.action)
    }
    if (r.user_id) userIdSet.add(r.user_id)
  }

  // Pull profile rows for the user filter dropdown. audit_log.user_id has
  // no FK to profiles in the generated types, so an embedded select returns
  // null. We do an explicit IN query and merge in memory.
  let users: FacetUser[] = []
  if (userIdSet.size > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', Array.from(userIdSet))
    users = (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name ?? null,
      email: p.email ?? null,
    }))
  }

  // Resolve user display info for the rows on this page.
  const rowUserIds = new Set<string>()
  for (const r of rows ?? []) if (r.user_id) rowUserIds.add(r.user_id)
  const missing = Array.from(rowUserIds).filter(
    (id) => !users.find((u) => u.id === id),
  )
  if (missing.length > 0) {
    const { data: extra } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', missing)
    for (const p of extra ?? []) {
      users.push({
        id: p.id,
        full_name: p.full_name ?? null,
        email: p.email ?? null,
      })
    }
  }

  const userById: Record<string, FacetUser> = {}
  for (const u of users) userById[u.id] = u

  const events: AuditEvent[] = (rows ?? []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    user_id: r.user_id,
    user: r.user_id ? userById[r.user_id] ?? null : null,
    action: r.action,
    table_name: r.table_name,
    record_id: r.record_id,
    changes: r.changes,
  }))

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <AuditContent
      events={events}
      total={totalCount}
      page={page}
      totalPages={totalPages}
      pageSize={PAGE_SIZE}
      facetUsers={users.sort((a, b) =>
        (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''),
      )}
      facetTables={Array.from(tables).sort()}
      facetActionPrefixes={Array.from(actionPrefixes).sort()}
      query={q}
      userFilter={userFilter}
      tableFilter={tableFilter}
      actionPrefixFilter={actionPrefix}
      fromFilter={fromIso}
      toFilter={toIso}
    />
  )
}
