import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import InventoryContent, { type InventoryListRow } from './content'
import type {
  InventoryCategory,
  InventorySource,
  InventoryStatus,
} from '@/types/database-aliases'

type SearchParams = Promise<{
  q?: string
  status?: string
  source?: string
  category?: string
}>

export default async function InventoryPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const statusFilter = (params.status ?? '') as InventoryStatus | ''
  const sourceFilter = (params.source ?? '') as InventorySource | ''
  const categoryFilter = (params.category ?? '') as InventoryCategory | ''

  let query = ctx.supabase
    .from('inventory_items')
    .select(
      'id, sku, sku_number, description, category, brand, model, serial_number, source, status, list_price, sale_price, created_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('sku_number', { ascending: false })
    .limit(200)

  if (statusFilter) query = query.eq('status', statusFilter)
  if (sourceFilter) query = query.eq('source', sourceFilter)
  if (categoryFilter) query = query.eq('category', categoryFilter)

  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(
      `sku.ilike.%${escaped}%,description.ilike.%${escaped}%,brand.ilike.%${escaped}%,serial_number.ilike.%${escaped}%`,
    )
  }

  const { data: items } = await query
  const itemRows = items ?? []

  // Pull primary photo for each item to render the list thumbnail. One
  // round-trip: select all primary photos for the page's items in one
  // shot, then merge.
  let thumbsByItem: Record<string, string | null> = {}
  if (itemRows.length > 0) {
    const ids = itemRows.map((r) => r.id)
    const { data: photos } = await ctx.supabase
      .from('inventory_item_photos')
      .select('item_id, storage_path, is_primary, position')
      .in('item_id', ids)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true })

    // Pick the first photo per item (primary first, else lowest position).
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

  const rows: InventoryListRow[] = itemRows.map((r) => ({
    id: r.id,
    sku: r.sku,
    description: r.description,
    category: r.category,
    brand: r.brand,
    model: r.model,
    serial_number: r.serial_number,
    source: r.source,
    status: r.status,
    list_price: r.list_price,
    sale_price: r.sale_price,
    created_at: r.created_at,
    thumb_url: thumbsByItem[r.id] ?? null,
  }))

  return (
    <InventoryContent
      items={rows}
      query={q}
      statusFilter={statusFilter}
      sourceFilter={sourceFilter}
      categoryFilter={categoryFilter}
    />
  )
}
