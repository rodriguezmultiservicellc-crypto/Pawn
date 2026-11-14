/**
 * GET /s/{slug}/feeds/products.xml — the shop's product feed for Google
 * Merchant Center and Meta catalogs (PLAN-2026-11-13 Phase 4). Only when the
 * owner turned it on (settings.product_feed_enabled). Reads public views
 * only; a piece that sells or goes into a checkout drops out of the next
 * fetch.
 */

import { fetchPublicStore, fetchPublicTenant, storeBaseUrl } from '@/lib/tenant-resolver'
import { buildFeedXml } from '@/lib/store/feed'
import { loadFeedItems } from '@/lib/store/feed-data'

export const revalidate = 3600

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await props.params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant?.public_slug || !tenant.has_retail || !tenant.public_catalog_enabled) {
    return new Response('not_found', { status: 404 })
  }
  const store = await fetchPublicStore(tenant.id)
  if (!store?.feedEnabled) return new Response('not_found', { status: 404 })

  const [baseUrl, items] = await Promise.all([storeBaseUrl(tenant.public_slug), loadFeedItems(tenant.id)])
  const body = buildFeedXml(
    {
      name: tenant.dba ?? tenant.name,
      baseUrl,
      ship: { enabled: store.shipEnabled, flatRate: store.shipFlatRate, freeOver: store.shipFreeOver },
    },
    items,
  )
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  })
}
