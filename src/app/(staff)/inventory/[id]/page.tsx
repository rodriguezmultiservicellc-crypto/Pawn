import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import {
  computeMeltValue,
  meltMetalFromItem,
  purityFromItem,
} from '@/lib/spot-prices/melt'
import InventoryDetail, {
  type InventoryMeltSummary,
  type InventoryPhotoItem,
  type InventoryStoneItem,
} from './content'

type Params = Promise<{ id: string }>

export default async function InventoryItemPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: item } = await ctx.supabase
    .from('inventory_items')
    .select(
      'id, tenant_id, sku, sku_number, description, category, brand, model, serial_number, metal, karat, weight_grams, weight_dwt, cost_basis, list_price, sale_price, sold_at, source, source_vendor, acquired_at, acquired_cost, hold_until, location, status, notes, staff_memo, tags, created_at, updated_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!item) redirect('/inventory')

  const { data: photoRows } = await ctx.supabase
    .from('inventory_item_photos')
    .select(
      'id, storage_path, mime_type, byte_size, position, is_primary, caption, created_at',
    )
    .eq('item_id', id)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })

  const photos: InventoryPhotoItem[] = await Promise.all(
    (photoRows ?? []).map(async (p) => ({
      id: p.id,
      mime_type: p.mime_type,
      position: p.position,
      is_primary: p.is_primary,
      caption: p.caption,
      created_at: p.created_at,
      signed_url: await getSignedUrl({
        bucket: INVENTORY_PHOTOS_BUCKET,
        path: p.storage_path,
        ttlSeconds: 3600,
      }),
    })),
  )

  const { data: stoneRows } = await ctx.supabase
    .from('inventory_item_stones')
    .select(
      'id, count, stone_type, cut, carat, is_total_carat, color, clarity, certificate, position, notes, created_at',
    )
    .eq('item_id', id)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const stones: InventoryStoneItem[] = (stoneRows ?? []).map((s) => ({
    id: s.id,
    count: s.count,
    stone_type: s.stone_type,
    cut: s.cut,
    carat:
      s.carat == null
        ? null
        : typeof s.carat === 'number'
        ? s.carat
        : Number(s.carat),
    is_total_carat: s.is_total_carat,
    color: s.color,
    clarity: s.clarity,
    certificate: s.certificate,
    position: s.position,
    notes: s.notes,
  }))

  // Compute the estimated melt value server-side so it's never stale
  // beyond the 5-minute spot-lookup cache. Returns null when the item
  // isn't a precious-metal item OR weight/karat is missing.
  const melt = await resolveMelt({
    tenantId: item.tenant_id,
    metal: item.metal,
    karat: item.karat,
    weightGrams: item.weight_grams,
  })

  return (
    <InventoryDetail
      item={item}
      photos={photos}
      stones={stones}
      melt={melt}
    />
  )
}

async function resolveMelt(args: {
  tenantId: string
  metal: string | null
  karat: number | string | null
  weightGrams: number | string | null
}): Promise<InventoryMeltSummary | null> {
  const metalType = meltMetalFromItem(args.metal as never)
  const purity = purityFromItem({
    metal: args.metal as never,
    karat: args.karat,
  })
  if (!metalType || !purity) return null

  const result = await computeMeltValue({
    metalType,
    purity,
    weightGrams: args.weightGrams,
    tenantId: args.tenantId,
  })
  if (!result) return null

  return {
    value: result.value,
    effective_per_gram: result.effectivePerGram,
    spot_per_gram: result.spotPerGram,
    multiplier: result.multiplier,
    source: result.source,
    fetched_at: result.fetchedAt,
    purity,
  }
}
