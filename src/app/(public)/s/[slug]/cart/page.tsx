import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { fetchPublicStore, fetchPublicTenant } from '@/lib/tenant-resolver'
import CartContent from './content'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { robots: { index: false } }

/** /s/[slug]/cart — the cart and the checkout form (guest checkout). */
export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant || !tenant.has_retail || !tenant.public_catalog_enabled) notFound()
  const store = await fetchPublicStore(tenant.id)
  if (!store?.checkoutEnabled) notFound()
  return <CartContent tenant={tenant} store={store} />
}
