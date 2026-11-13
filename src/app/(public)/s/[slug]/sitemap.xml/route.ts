/**
 * GET /s/{slug}/sitemap.xml — one shop's sitemap: landing, catalog, policies
 * and every piece in the public catalog. URLs use the shop's verified custom
 * domain when it has one. Reads the public views only.
 */

import { createClient } from '@/lib/supabase/server'
import { fetchPublicTenant, storeBaseUrl } from '@/lib/tenant-resolver'

export const revalidate = 3600

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await props.params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant?.public_slug) return new Response('not_found', { status: 404 })
  const base = await storeBaseUrl(tenant.public_slug)

  const urls: Array<{ loc: string; lastmod?: string }> = [{ loc: base }, { loc: `${base}/policies` }]
  if (tenant.has_retail && tenant.public_catalog_enabled) {
    urls.push({ loc: `${base}/catalog` })
    const supabase = await createClient()
    const { data: items } = await supabase
      .from('public_catalog_items')
      .select('sku, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(5000)
    for (const i of items ?? []) {
      if (i.sku) urls.push({ loc: `${base}/catalog/${encodeURIComponent(i.sku)}`, lastmod: i.created_at?.slice(0, 10) })
    }
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n'
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
