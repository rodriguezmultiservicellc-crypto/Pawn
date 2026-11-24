import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrls,
} from '@/lib/supabase/storage'
import InventoryContent, {
  type InventoryCoatingFilter,
  type InventoryConditionFilter,
  type InventoryListRow,
} from './content'
import type {
  InventoryCategory,
  InventorySource,
  InventoryStatus,
} from '@/types/database-aliases'
import { loadTagTemplates } from '@/lib/labels/load'
import { templateChoices } from '@/lib/labels/templates'
import { resolveImportRole } from '@/lib/imports/access'
import {
  INVENTORY_PAGE_SIZE,
  inventorySearchFilters,
} from '@/lib/inventory/search'

type SearchParams = Promise<{
  q?: string
  status?: string
  source?: string
  category?: string
  condition?: string
  coating?: string
  tag?: string
  page?: string
}>

export default async function InventoryPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const tenantId = ctx.tenantId

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const statusFilter = (params.status ?? '') as InventoryStatus | ''
  const sourceFilter = (params.source ?? '') as InventorySource | ''
  const categoryFilter = (params.category ?? '') as InventoryCategory | ''
  const conditionFilter = (params.condition ?? '') as InventoryConditionFilter
  const coatingFilter = (params.coating ?? '') as InventoryCoatingFilter
  // 'needed' = sellable stock that has never had a tag printed (patches/0074).
  const needsTag = params.tag === 'needed'
  const page = Math.max(1, Math.floor(Number(params.page)) || 1)
  const from = (page - 1) * INVENTORY_PAGE_SIZE

  // One page at a time, with the total for the pager.
  let query = ctx.supabase
    .from('inventory_items')
    .select(
      'id, sku, sku_number, description, category, brand, model, serial_number, source, status, list_price, sale_price, created_at, coating, condition, legacy_code, shelf_location, tag_printed_at, karat, weight_grams',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sku_number', { ascending: false })
    .range(from, from + INVENTORY_PAGE_SIZE - 1)

  if (statusFilter) query = query.eq('status', statusFilter)
  if (sourceFilter) query = query.eq('source', sourceFilter)
  if (categoryFilter) query = query.eq('category', categoryFilter)
  if (conditionFilter) query = query.eq('condition', conditionFilter)
  // 'coated' = anything that is not solid metal (patches/0067).
  if (coatingFilter === 'coated') query = query.neq('coating', 'none')
  else if (coatingFilter) query = query.eq('coating', coatingFilter)

  if (needsTag) {
    query = query.is('tag_printed_at', null).in('status', ['available', 'held'])
  }

  // Every word must match somewhere (src/lib/inventory/search.ts).
  for (const filter of inventorySearchFilters(q)) query = query.or(filter)

  // The list, the import role and the tag templates don't depend on each
  // other: fetch them together.
  const [{ data: items, count }, importRole, tagTemplates] = await Promise.all([
    query,
    resolveImportRole(ctx),
    loadTagTemplates(ctx.supabase, tenantId),
  ])
  const itemRows = items ?? []

  // Thumbnails: the page's photos in one query, signed in one request.
  const thumbsByItem = new Map<string, string>()
  if (itemRows.length > 0) {
    const { data: photos } = await ctx.supabase
      .from('inventory_item_photos')
      .select('item_id, storage_path, is_primary, position')
      .in('item_id', itemRows.map((r) => r.id))
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true })

    // The first photo per item: primary first, else the lowest position.
    const pathByItem = new Map<string, string>()
    for (const p of photos ?? []) {
      if (!pathByItem.has(p.item_id)) pathByItem.set(p.item_id, p.storage_path)
    }
    const urls = await getSignedUrls({
      bucket: INVENTORY_PHOTOS_BUCKET,
      paths: [...new Set(pathByItem.values())],
      ttlSeconds: 3600,
    })
    for (const [itemId, path] of pathByItem) {
      const url = urls.get(path)
      if (url) thumbsByItem.set(itemId, url)
    }
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
    thumb_url: thumbsByItem.get(r.id) ?? null,
    coating: r.coating,
    condition: r.condition,
    legacy_code: r.legacy_code,
    shelf_location: r.shelf_location,
    tag_printed_at: r.tag_printed_at,
    karat: r.karat,
    weight_grams: r.weight_grams,
  }))

  return (
    <InventoryContent
      items={rows}
      total={count ?? rows.length}
      page={page}
      pageSize={INVENTORY_PAGE_SIZE}
      query={q}
      statusFilter={statusFilter}
      sourceFilter={sourceFilter}
      categoryFilter={categoryFilter}
      conditionFilter={conditionFilter}
      coatingFilter={coatingFilter}
      needsTag={needsTag}
      canImport={importRole !== null}
      tagChoices={templateChoices(tagTemplates, 'inventory')}
    />
  )
}
