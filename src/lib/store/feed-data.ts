import 'server-only'

/**
 * Reads a shop's feed rows from the public views only (patches/0080), so the
 * feed can never show more than the public catalog page does.
 */

import { createClient } from '@/lib/supabase/server'
import { FEED_MAX_ITEMS, type FeedItem } from './feed'

const PHOTO_CHUNK = 200

export async function loadFeedItems(tenantId: string): Promise<FeedItem[]> {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('public_catalog_items')
    .select('id, sku, description, category, brand, model, metal, karat, weight_grams, condition, list_price')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(FEED_MAX_ITEMS)

  const items = (rows ?? []).filter(
    (r): r is typeof r & { id: string; sku: string; category: NonNullable<typeof r.category> } =>
      !!r.id && !!r.sku && !!r.category && r.list_price != null,
  )
  if (items.length === 0) return []

  // Photo ids per item, primary first then by position.
  const photos = new Map<string, string[]>()
  for (let k = 0; k < items.length; k += PHOTO_CHUNK) {
    const ids = items.slice(k, k + PHOTO_CHUNK).map((r) => r.id)
    const { data } = await supabase
      .from('public_catalog_photos')
      .select('id, item_id')
      .in('item_id', ids)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true })
    for (const p of data ?? []) {
      if (!p.id || !p.item_id) continue
      const list = photos.get(p.item_id) ?? []
      list.push(p.id)
      photos.set(p.item_id, list)
    }
  }

  return items.map((r) => ({
    sku: r.sku,
    description: r.description ?? '',
    category: r.category,
    brand: r.brand,
    model: r.model,
    metal: r.metal,
    karat: r.karat,
    weight_grams: r.weight_grams == null ? null : Number(r.weight_grams),
    condition: r.condition,
    list_price: Number(r.list_price),
    photoIds: photos.get(r.id) ?? [],
  }))
}
