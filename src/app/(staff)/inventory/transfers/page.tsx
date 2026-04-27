import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import TransfersContent, { type TransferListRow } from './content'
import type { TransferStatus } from '@/types/database-aliases'

type SearchParams = Promise<{
  status?: string
  direction?: string
}>

type TransferStatusFilter = 'pending' | 'accepted' | 'rejected' | 'cancelled' | ''
type TransferDirectionFilter = 'incoming' | 'outgoing' | ''

const STATUS_VALUES: ReadonlyArray<TransferStatusFilter> = [
  '',
  'pending',
  'accepted',
  'rejected',
  'cancelled',
]
const DIRECTION_VALUES: ReadonlyArray<TransferDirectionFilter> = [
  '',
  'incoming',
  'outgoing',
]

function coerceStatus(v: string | undefined): TransferStatusFilter {
  return STATUS_VALUES.includes((v ?? '') as TransferStatusFilter)
    ? ((v ?? '') as TransferStatusFilter)
    : ''
}

function coerceDirection(v: string | undefined): TransferDirectionFilter {
  return DIRECTION_VALUES.includes((v ?? '') as TransferDirectionFilter)
    ? ((v ?? '') as TransferDirectionFilter)
    : ''
}

/**
 * Inventory transfers list. RLS already permits the active tenant to see
 * any row where it is the from_tenant_id OR to_tenant_id; we still scope
 * the SELECT explicitly for clarity.
 *
 * The transfer rows have references to the new metadata + child item
 * tables introduced in patches/0006-transfer-metadata.sql. Until that
 * migration is applied, the generated database types lag. We use the
 * admin client with explicit casts at the read boundary; tenant gating
 * happens via the explicit from/to filters.
 */
export default async function TransfersListPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const statusFilter = coerceStatus(params.status)
  const directionFilter = coerceDirection(params.direction)

  // Use the admin client because the metadata columns + the child item
  // table are post-0006 — the user-scoped types lag the schema until
  // db:types regenerates. Tenant scoping is enforced explicitly via the
  // from/to filters below.
  const admin = createAdminClient()

  let query = admin
    .from('inventory_transfers')
    .select(
      'id, from_tenant_id, to_tenant_id, status, notes, requested_at, requested_by, accepted_at, rejected_at, cancelled_at',
    )
    .is('deleted_at', null)
    .order('requested_at', { ascending: false })
    .limit(200)

  if (directionFilter === 'incoming') {
    query = query.eq('to_tenant_id', ctx.tenantId)
  } else if (directionFilter === 'outgoing') {
    query = query.eq('from_tenant_id', ctx.tenantId)
  } else {
    // Either side. Supabase OR for two equality predicates against the
    // same tenant id.
    query = query.or(
      `from_tenant_id.eq.${ctx.tenantId},to_tenant_id.eq.${ctx.tenantId}`,
    )
  }

  if (statusFilter) {
    // Cast: the post-0006 enum adds 'accepted' / 'rejected' to the existing
    // 'pending' / 'in_transit' / 'received' / 'cancelled' set; the
    // generated types still reflect 0003.
    query = query.eq(
      'status',
      statusFilter as 'pending' | 'cancelled' | 'in_transit' | 'received',
    )
  }

  type RawTransferRow = {
    id: string
    from_tenant_id: string
    to_tenant_id: string
    status: TransferStatus
    notes: string | null
    requested_at: string | null
    requested_by: string | null
    accepted_at: string | null
    rejected_at: string | null
    cancelled_at: string | null
  }

  const { data: transfersData } = await query
  const transfers: RawTransferRow[] =
    (transfersData as unknown as RawTransferRow[] | null) ?? []

  // Resolve shop names + item counts in parallel.
  const tenantIds = Array.from(
    new Set(
      transfers.flatMap((t) => [t.from_tenant_id, t.to_tenant_id]),
    ),
  )
  const userIds = Array.from(
    new Set(transfers.map((t) => t.requested_by).filter((v): v is string => !!v)),
  )
  const transferIds = transfers.map((t) => t.id)

  const [tenantsRes, profilesRes, itemCountsRes] = await Promise.all([
    tenantIds.length
      ? admin
          .from('tenants')
          .select('id, name, dba')
          .in('id', tenantIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? admin
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds)
      : Promise.resolve({ data: [] }),
    transferIds.length
      ? admin
          // Post-0006 child table; generated types lag.
          .from('inventory_transfer_items' as never)
          .select('transfer_id, est_value')
          .in('transfer_id', transferIds)
      : Promise.resolve({ data: [] }),
  ])

  const tenantsById = new Map<string, { name: string; dba: string | null }>()
  for (const row of (tenantsRes.data ?? []) as Array<{
    id: string
    name: string
    dba: string | null
  }>) {
    tenantsById.set(row.id, { name: row.name, dba: row.dba })
  }

  const profilesById = new Map<
    string,
    { full_name: string | null; email: string | null }
  >()
  for (const row of (profilesRes.data ?? []) as Array<{
    id: string
    full_name: string | null
    email: string | null
  }>) {
    profilesById.set(row.id, { full_name: row.full_name, email: row.email })
  }

  const itemRollupByTransfer = new Map<
    string,
    { count: number; totalValue: number }
  >()
  for (const row of (itemCountsRes.data as unknown as Array<{
    transfer_id: string
    est_value: number | string | null
  }> | null) ?? []) {
    const prev = itemRollupByTransfer.get(row.transfer_id) ?? {
      count: 0,
      totalValue: 0,
    }
    const v =
      row.est_value == null
        ? 0
        : typeof row.est_value === 'number'
        ? row.est_value
        : parseFloat(row.est_value)
    itemRollupByTransfer.set(row.transfer_id, {
      count: prev.count + 1,
      totalValue: prev.totalValue + (isFinite(v) ? v : 0),
    })
  }

  // Counts per status (for filter chips). Cheap because we already have
  // every row that this tenant can see.
  const statusCounts: Record<string, number> = {
    all: transfers.length,
    pending: 0,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
  }
  for (const t of transfers) {
    if (t.status in statusCounts) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1
  }

  function shopLabel(id: string): string {
    const row = tenantsById.get(id)
    if (!row) return id.slice(0, 8)
    return row.dba ? row.dba : row.name
  }

  function userLabel(id: string | null): string | null {
    if (!id) return null
    const row = profilesById.get(id)
    if (!row) return null
    return row.full_name ?? row.email ?? null
  }

  const rows: TransferListRow[] = transfers.map((t) => {
    const rollup = itemRollupByTransfer.get(t.id) ?? {
      count: 0,
      totalValue: 0,
    }
    const isOutgoing = t.from_tenant_id === ctx.tenantId
    return {
      id: t.id,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      from_tenant_id: t.from_tenant_id,
      to_tenant_id: t.to_tenant_id,
      from_shop_label: shopLabel(t.from_tenant_id),
      to_shop_label: shopLabel(t.to_tenant_id),
      status: t.status,
      item_count: rollup.count,
      total_value: rollup.totalValue,
      requested_at: t.requested_at,
      requested_by_label: userLabel(t.requested_by),
    }
  })

  return (
    <TransfersContent
      transfers={rows}
      statusFilter={statusFilter}
      directionFilter={directionFilter}
      statusCounts={statusCounts}
      activeTenantId={ctx.tenantId}
    />
  )
}
