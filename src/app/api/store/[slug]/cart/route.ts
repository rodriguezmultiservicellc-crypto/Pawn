/**
 * POST /api/store/{slug}/cart — which cart pieces are still for sale, at
 * what price, with a fresh photo URL. Public; reads the public views only
 * (a sold, reserved or hidden piece is simply not returned).
 */

import { createClient } from '@/lib/supabase/server'
import { fetchPublicTenant } from '@/lib/tenant-resolver'
import { cartRefreshSchema } from '@/lib/store/validation'
import { getSignedUrl, INVENTORY_PHOTOS_BUCKET } from '@/lib/supabase/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await props.params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant || !tenant.public_catalog_enabled) return Response.json({ items: [] })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ items: [] }, { status: 400 })
  }
  const parsed = cartRefreshSchema.safeParse(body)
  if (!parsed.success || parsed.data.itemIds.length === 0) return Response.json({ items: [] })

  const supabase = await createClient()
  const [{ data: items }, { data: photos }] = await Promise.all([
    supabase
      .from('public_catalog_items')
      .select('id, sku, description, list_price')
      .eq('tenant_id', tenant.id)
      .in('id', parsed.data.itemIds),
    supabase
      .from('public_catalog_photos')
      .select('item_id, storage_path, is_primary, position')
      .in('item_id', parsed.data.itemIds)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true }),
  ])

  const firstPhoto = new Map<string, string>()
  for (const p of photos ?? []) {
    if (p.item_id && p.storage_path && !firstPhoto.has(p.item_id)) firstPhoto.set(p.item_id, p.storage_path)
  }

  const out = await Promise.all(
    (items ?? []).map(async (i) => {
      const path = i.id ? firstPhoto.get(i.id) : undefined
      return {
        id: i.id,
        sku: i.sku,
        description: i.description,
        price: Number(i.list_price),
        photoUrl: path ? await getSignedUrl({ bucket: INVENTORY_PHOTOS_BUCKET, path, ttlSeconds: 3600 }) : null,
      }
    }),
  )
  return Response.json({ items: out }, { headers: { 'Cache-Control': 'no-store' } })
}
