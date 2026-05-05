import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { fetchPublicTenant, type PublicTenant } from '@/lib/tenant-resolver'
import { loadPublicReviews } from '@/lib/google-reviews/cache'
import LandingPageContent from './content'

export const revalidate = 60

type Params = Promise<{ slug: string }>

/**
 * Public tenant landing — first surface in Phase 10 Path A. Renders at
 * `/s/<slug>` for any tenant where public_landing_enabled=TRUE and
 * is_active=TRUE. RLS gates the fetch (tenants_public_landing_select),
 * so a missing or disabled landing both 404 without leaking which.
 *
 * Same RSC handles the subdomain form (acme.basedomain.com → rewritten
 * by proxy.ts to /s/acme).
 *
 * Catalog, loyalty/referral signup, Google Reviews embed, and the
 * email-campaign capture form are each follow-up sessions per
 * Progress.txt. This session ships the static content surface.
 */
export default async function PublicLandingPage({
  params,
}: {
  params: Params
}) {
  const { slug } = await params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant) notFound()
  const reviews = await loadPublicReviews(tenant.id)
  return <LandingPageContent tenant={tenant} reviews={reviews} />
}

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { slug } = await params
  const tenant = await fetchPublicTenant(slug)
  if (!tenant) return { title: 'Not found' }
  const display = displayName(tenant)
  const cityState = [tenant.city, tenant.state].filter(Boolean).join(', ')
  const description =
    tenant.public_about?.slice(0, 160) ??
    (cityState
      ? `${display} — pawn, jewelry, and repair in ${cityState}.`
      : `${display} — pawn, jewelry, and repair.`)
  return {
    title: display,
    description,
    openGraph: {
      title: display,
      description,
      type: 'website',
    },
  }
}

function displayName(t: PublicTenant): string {
  return t.dba ?? t.name
}
