// src/lib/loyalty/url.ts
import 'server-only'

/**
 * Build the public landing URL for a tenant. Subdomain form when
 * NEXT_PUBLIC_BASE_DOMAIN is set, path-form fallback otherwise.
 *
 *   buildPublicLandingUrl({ slug: 'acme', baseDomain: 'pawnshop.com', appUrl: 'https://pawnshop.com' })
 *     → 'https://acme.pawnshop.com'
 *
 *   buildPublicLandingUrl({ slug: 'acme', baseDomain: null, appUrl: 'https://pawn.example.com' })
 *     → 'https://pawn.example.com/s/acme'
 *
 *   buildPublicLandingUrl({ slug: null, ... })  // tenant has no public slug
 *     → null
 */
export function buildPublicLandingUrl(args: {
  slug: string | null
  baseDomain: string | null | undefined
  appUrl: string | null | undefined
}): string | null {
  if (!args.slug) return null
  const slug = args.slug.toLowerCase()
  const base = (args.baseDomain ?? '').trim()
  const app = (args.appUrl ?? '').trim().replace(/\/$/, '')

  if (base) {
    // Subdomain form. Inherit https unless appUrl explicitly says http.
    const proto = app.startsWith('http://') ? 'http' : 'https'
    return `${proto}://${slug}.${base}`
  }
  if (app) {
    return `${app}/s/${slug}`
  }
  return `/s/${slug}`
}
