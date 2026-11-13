import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { fetchPublicTenant } from '@/lib/tenant-resolver'
import { cancelPendingByToken, loadOrderByToken } from '@/lib/store/orders'
import OrderStatusContent from './content'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * /s/[slug]/order/[token] — the shopper's order page. Stripe returns here
 * (?paid=1 or ?cancelled=1). The token is the only key; nothing staff-only
 * is shown. A cancelled payment releases the pieces right away.
 */
export default async function OrderStatusPage(props: {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ paid?: string; cancelled?: string }>
}) {
  const [{ slug, token }, sp] = await Promise.all([props.params, props.searchParams])
  const tenant = await fetchPublicTenant(slug)
  if (!tenant) notFound()

  if (sp.cancelled === '1') await cancelPendingByToken(tenant.id, token)
  const order = await loadOrderByToken(tenant.id, token)
  if (!order) notFound()

  return <OrderStatusContent tenant={tenant} order={order} justPaid={sp.paid === '1'} />
}
