/**
 * GET /s/{slug}/catalog/{sku}/image — the item's primary photo, as a
 * redirect to a freshly signed URL.
 *
 * Share previews (Open Graph), Google's product data and feeds fetch an
 * image long after the page was rendered, when a signed URL baked into the
 * page has already expired. This stable address signs a new one on every
 * request. Storage stays private: only pieces in the public catalog view
 * resolve, and the signed URL still expires in an hour.
 */

import { createClient } from '@/lib/supabase/server'
import { fetchPublicTenant } from '@/lib/tenant-resolver'
import { getSignedUrl, INVENTORY_PHOTOS_BUCKET } from '@/lib/supabase/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, props: { params: Promise<{ slug: string; sku: string }> }): Promise<Response> {
  const { slug, sku } = await props.params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant?.public_catalog_enabled) return new Response('not_found', { status: 404 })

  const supabase = await createClient()
  const { data: item } = await supabase
    .from('public_catalog_items')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('sku', decodeURIComponent(sku))
    .maybeSingle()
  if (!item?.id) return new Response('not_found', { status: 404 })

  const { data: photo } = await supabase
    .from('public_catalog_photos')
    .select('storage_path')
    .eq('item_id', item.id)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!photo?.storage_path) return new Response('not_found', { status: 404 })

  const url = await getSignedUrl({ bucket: INVENTORY_PHOTOS_BUCKET, path: photo.storage_path, ttlSeconds: 3600 })
  if (!url) return new Response('not_found', { status: 404 })
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'public, max-age=300' },
  })
}
