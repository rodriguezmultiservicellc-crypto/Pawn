import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { fetchPublicStore, fetchPublicTenant } from '@/lib/tenant-resolver'
import PoliciesContent from './content'

export const revalidate = 60

/** /s/[slug]/policies — return and shipping policies (card processors and Google require them). */
export default async function PoliciesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant) notFound()
  const store = await fetchPublicStore(tenant.id)
  return <PoliciesContent tenant={tenant} store={store} />
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const tenant = await fetchPublicTenant(slug)
  return { title: tenant ? `Policies — ${tenant.dba ?? tenant.name}` : 'Not found' }
}
