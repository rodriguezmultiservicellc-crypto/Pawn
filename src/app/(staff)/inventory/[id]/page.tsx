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
import { createAdminClient } from '@/lib/supabase/admin'
import InventoryDetail, {
  type InventoryMeltSummary,
  type InventoryPhotoItem,
  type InventoryStoneItem,
} from './content'
import type {
  EbayListingRow,
  TenantEbayCredentialsRow,
} from '@/types/database-aliases'
import type { EbayPanelListing } from '@/components/ebay/InventoryEbayPanel'

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

  // ── eBay panel data ─────────────────────────────────────────────────────
  // Load tenant credentials + most-recent draft/active listing so the
  // detail page can render the eBay publishing panel inline.
  const admin = createAdminClient()

  const { data: credRow } = await admin
    .from('tenant_ebay_credentials')
    .select('refresh_token, disconnected_at')
    .eq('tenant_id', item.tenant_id)
    .maybeSingle()
  const ebayConnected =
    !!credRow?.refresh_token && !credRow.disconnected_at

  const { data: listingRow } = (await admin
    .from('ebay_listings')
    .select(
      'id, status, ebay_listing_id, ebay_offer_id, ebay_sku, title, condition_id, category_id, format, list_price, currency, quantity, description, marketing_message, photo_urls, view_count, watcher_count, last_synced_at, error_text',
    )
    .eq('tenant_id', item.tenant_id)
    .eq('inventory_item_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: EbayListingRow | null }

  const ebayListing: EbayPanelListing | null = listingRow
    ? {
        id: listingRow.id,
        status: listingRow.status,
        ebay_listing_id: listingRow.ebay_listing_id,
        ebay_offer_id: listingRow.ebay_offer_id,
        ebay_sku: listingRow.ebay_sku,
        title: listingRow.title,
        condition_id: listingRow.condition_id,
        category_id: listingRow.category_id,
        format: listingRow.format,
        list_price:
          typeof listingRow.list_price === 'string'
            ? listingRow.list_price
            : String(listingRow.list_price ?? ''),
        currency: listingRow.currency,
        quantity: listingRow.quantity,
        description: listingRow.description,
        marketing_message: listingRow.marketing_message,
        photo_urls: listingRow.photo_urls ?? [],
        view_count: listingRow.view_count,
        watcher_count: listingRow.watcher_count,
        last_synced_at: listingRow.last_synced_at,
        error_text: listingRow.error_text,
      }
    : null

  return (
    <InventoryDetail
      item={item}
      photos={photos}
      stones={stones}
      melt={melt}
      ebayConnected={ebayConnected}
      ebayListing={ebayListing}
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
