import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import TransferDetail, {
  type TransferDetailData,
  type TransferDetailItem,
} from './content'
import type { TransferStatus } from '@/types/database-aliases'

type Params = Promise<{ id: string }>

type RawTransferRow = {
  id: string
  tenant_id: string
  from_tenant_id: string
  to_tenant_id: string
  status: TransferStatus
  notes: string | null
  rejection_reason: string | null
  requested_at: string | null
  requested_by: string | null
  accepted_at: string | null
  accepted_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
}

type RawTransferItem = {
  id: string
  inventory_item_id: string
  sku_snapshot: string | null
  description_snapshot: string | null
  est_value: number | string | null
}

export default async function TransferDetailPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Use admin client for read because the post-0006 columns aren't in
  // the generated types yet. RLS isn't bypassed for the access-control
  // decision — we explicitly check that the active tenant is on either
  // side of the transfer below.
  const admin = createAdminClient()

  const { data: rawTransfer } = await admin
    .from('inventory_transfers')
    .select(
      'id, tenant_id, from_tenant_id, to_tenant_id, status, notes, rejection_reason, requested_at, requested_by, accepted_at, accepted_by, rejected_at, rejected_by, cancelled_at, cancelled_by',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  const transfer = rawTransfer as unknown as RawTransferRow | null
  if (!transfer) redirect('/inventory/transfers')

  const isFrom = transfer.from_tenant_id === ctx.tenantId
  const isTo = transfer.to_tenant_id === ctx.tenantId
  if (!isFrom && !isTo) {
    // The active tenant is not on either side — they shouldn't see this.
    redirect('/inventory/transfers')
  }

  const { data: rawItems } = await admin
    .from('inventory_transfer_items' as never)
    .select(
      'id, inventory_item_id, sku_snapshot, description_snapshot, est_value',
    )
    .eq('transfer_id', id)

  const itemRows = (rawItems as unknown as RawTransferItem[] | null) ?? []
  const inventoryItemIds = itemRows.map((r) => r.inventory_item_id)

  // Pull the live inventory rows for any items still around. The active
  // side may have moved (post-acceptance) but RLS via user-scoped client
  // would only see the items belonging to the active tenant. Use admin
  // since both sides need to render.
  const liveItems = inventoryItemIds.length
    ? await admin
        .from('inventory_items')
        .select('id, sku, description, category, tenant_id, status')
        .in('id', inventoryItemIds)
    : { data: [] }

  type LiveItem = {
    id: string
    sku: string
    description: string
    category: string
    tenant_id: string
    status: string
  }
  const liveByItemId = new Map<string, LiveItem>()
  for (const it of (liveItems.data ?? []) as LiveItem[]) {
    liveByItemId.set(it.id, it)
  }

  // Primary photo for each item, in parallel.
  let thumbsByItem: Record<string, string | null> = {}
  if (inventoryItemIds.length > 0) {
    const { data: photos } = await admin
      .from('inventory_item_photos')
      .select('item_id, storage_path, is_primary, position')
      .in('item_id', inventoryItemIds)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true })

    const seen = new Set<string>()
    const tasks: Array<Promise<void>> = []
    for (const p of photos ?? []) {
      if (seen.has(p.item_id)) continue
      seen.add(p.item_id)
      tasks.push(
        getSignedUrl({
          bucket: INVENTORY_PHOTOS_BUCKET,
          path: p.storage_path,
          ttlSeconds: 3600,
        }).then((url) => {
          thumbsByItem = { ...thumbsByItem, [p.item_id]: url }
        }),
      )
    }
    await Promise.all(tasks)
  }

  const items: TransferDetailItem[] = itemRows.map((row) => {
    const live = liveByItemId.get(row.inventory_item_id)
    const est =
      row.est_value == null
        ? null
        : typeof row.est_value === 'number'
        ? row.est_value
        : parseFloat(String(row.est_value))
    return {
      id: row.id,
      inventory_item_id: row.inventory_item_id,
      sku: live?.sku ?? row.sku_snapshot ?? null,
      description: live?.description ?? row.description_snapshot ?? null,
      category: live?.category ?? null,
      est_value: est,
      thumb_url: thumbsByItem[row.inventory_item_id] ?? null,
      // Whether the live row is still visible to the active tenant.
      // (RLS would hide it post-acceptance from the from-tenant; we use
      // admin client so we can show it on both sides.)
      currently_owned_by_active: live
        ? live.tenant_id === ctx.tenantId
        : false,
    }
  })

  // Resolve shop names + actor profile names via admin client.
  const tenantIds = Array.from(
    new Set([transfer.from_tenant_id, transfer.to_tenant_id]),
  )
  const userIds = Array.from(
    new Set(
      [
        transfer.requested_by,
        transfer.accepted_by,
        transfer.rejected_by,
        transfer.cancelled_by,
      ].filter((v): v is string => !!v),
    ),
  )

  const [tenantsRes, profilesRes] = await Promise.all([
    admin.from('tenants').select('id, name, dba').in('id', tenantIds),
    userIds.length
      ? admin.from('profiles').select('id, full_name, email').in('id', userIds)
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

  function shopLabel(id: string): string {
    const row = tenantsById.get(id)
    if (!row) return id.slice(0, 8)
    return row.dba ?? row.name
  }
  function userLabel(id: string | null): string | null {
    if (!id) return null
    const row = profilesById.get(id)
    if (!row) return null
    return row.full_name ?? row.email ?? null
  }

  const data: TransferDetailData = {
    id: transfer.id,
    status: transfer.status,
    from_tenant_id: transfer.from_tenant_id,
    to_tenant_id: transfer.to_tenant_id,
    from_shop_label: shopLabel(transfer.from_tenant_id),
    to_shop_label: shopLabel(transfer.to_tenant_id),
    notes: transfer.notes,
    rejection_reason: transfer.rejection_reason,
    requested_at: transfer.requested_at,
    requested_by_label: userLabel(transfer.requested_by),
    accepted_at: transfer.accepted_at,
    accepted_by_label: userLabel(transfer.accepted_by),
    rejected_at: transfer.rejected_at,
    rejected_by_label: userLabel(transfer.rejected_by),
    cancelled_at: transfer.cancelled_at,
    cancelled_by_label: userLabel(transfer.cancelled_by),
    items,
    viewerSide: isFrom ? 'from' : 'to',
  }

  return <TransferDetail data={data} activeTenantId={ctx.tenantId} />
}
