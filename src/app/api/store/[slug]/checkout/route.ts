/**
 * POST /api/store/{slug}/checkout — start paying for the cart.
 *
 * Public (no sign-in): a guest shopper. The shop is resolved from the slug
 * through the public view only. online_order_reserve() re-checks every piece
 * against the public catalog, reprices it, applies the shop's tax, shipping
 * and card limit, and refuses banned contacts; then a Stripe Checkout
 * session is created on the shop's connected account.
 *
 * Returns { url } to redirect to, or { error } with a store.errors key.
 */

import { fetchPublicTenant } from '@/lib/tenant-resolver'
import { checkoutSchema } from '@/lib/store/validation'
import { startCheckout } from '@/lib/store/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await props.params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant || !tenant.has_retail || !tenant.public_catalog_enabled || !tenant.public_slug) {
    return Response.json({ error: 'checkout_off' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid' }, { status: 400 })
  }
  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid', fields: parsed.error.issues.map((i) => i.path.join('.')) },
      { status: 400 },
    )
  }
  const v = parsed.data

  const r = await startCheckout({
    tenantId: tenant.id,
    slug: tenant.public_slug,
    itemIds: v.itemIds,
    name: v.name,
    email: v.email,
    phone: v.phone,
    language: v.language,
    fulfillment: v.fulfillment,
    address: v.fulfillment === 'ship' && v.address ? v.address : null,
  })
  if (!r.ok) {
    const status = r.error === 'generic' ? 500 : 409
    return Response.json({ error: r.error }, { status })
  }
  return Response.json({ url: r.url }, { headers: { 'Cache-Control': 'no-store' } })
}
