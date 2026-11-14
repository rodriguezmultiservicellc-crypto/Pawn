/**
 * GET /s/{slug}/img/{photoId} — one catalog photo at an address that never
 * expires (PLAN-2026-11-13 Phase 4).
 *
 * Feeds, share previews and product data fetch images days after the page
 * was rendered, long after a signed URL has expired. This route checks the
 * photo belongs to a piece in THIS shop's public catalog, then streams the
 * bytes. The bucket stays private: a photo of a piece that is sold, hidden
 * or unpublished answers 404, and storage itself is never exposed.
 */

import { createClient } from '@/lib/supabase/server'
import { fetchPublicTenant } from '@/lib/tenant-resolver'
import { getSignedUrl, INVENTORY_PHOTOS_BUCKET } from '@/lib/supabase/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new Response('not_found', { status: 404 })

export async function GET(_req: Request, props: { params: Promise<{ slug: string; photoId: string }> }): Promise<Response> {
  const { slug, photoId } = await props.params
  if (!UUID.test(photoId)) return notFound()
  const tenant = await fetchPublicTenant(slug)
  if (!tenant?.public_catalog_enabled || !tenant.has_retail) return notFound()

  const supabase = await createClient()
  const { data: photo } = await supabase
    .from('public_catalog_photos')
    .select('item_id, storage_path')
    .eq('id', photoId)
    .maybeSingle()
  if (!photo?.item_id || !photo.storage_path) return notFound()

  // The photo view is shop-agnostic; make sure the piece is this shop's.
  const { data: item } = await supabase
    .from('public_catalog_items')
    .select('id')
    .eq('id', photo.item_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!item) return notFound()

  const url = await getSignedUrl({ bucket: INVENTORY_PHOTOS_BUCKET, path: photo.storage_path, ttlSeconds: 60 })
  if (!url) return notFound()
  const upstream = await fetch(url, { cache: 'no-store' })
  if (!upstream.ok || !upstream.body) return notFound()

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
      // Edge-cached for a day; a sold piece's photo stops resolving after that.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
