import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { INVENTORY_PHOTOS_BUCKET, getSignedUrls } from '@/lib/supabase/storage'

/**
 * Every live photo of the given inventory items, signed for 1h, main first —
 * the inventory page's order (is_primary, then position). For pages that
 * show an item's photos read-only (buy ticket, layaway); photos are changed
 * on the item's inventory page.
 */
export async function signItemPhotos(
  client: SupabaseClient<Database>,
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (itemIds.length === 0) return out
  const { data: rows } = await client
    .from('inventory_item_photos')
    .select('item_id, storage_path')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })
  const urls = await getSignedUrls({
    bucket: INVENTORY_PHOTOS_BUCKET,
    paths: [...new Set((rows ?? []).map((r) => r.storage_path))],
    ttlSeconds: 3600,
  })
  for (const r of rows ?? []) {
    const url = urls.get(r.storage_path)
    if (url) out.set(r.item_id, [...(out.get(r.item_id) ?? []), url])
  }
  return out
}
