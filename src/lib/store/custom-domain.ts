/**
 * Custom store domains (patches/0079).
 *
 * The proxy asks "which shop owns this host?" on requests that do not come
 * in on the app's own hosts. The answer is read from the public view
 * public_custom_domains (verified domains only) with the anon key over
 * plain fetch, and cached in memory for a few minutes per instance, so a
 * normal request costs no database call.
 */

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { slug: string | null; at: number }>()

/** Lowercase host without port. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/**
 * Hosts that are the app itself, never a shop's own domain: localhost,
 * Vercel preview hosts, the app URL's host, and the base domain with its
 * tenant subdomains (those have their own rewrite).
 */
export function isAppHost(host: string, env: { appUrl?: string; baseDomain?: string }): boolean {
  if (!host || host === 'localhost' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return true
  if (host.endsWith('.vercel.app')) return true
  try {
    if (env.appUrl && new URL(env.appUrl).hostname.toLowerCase() === host) return true
  } catch {}
  const base = normalizeHost(env.baseDomain)
  if (base && (host === base || host.endsWith(`.${base}`))) return true
  return false
}

/** Shape a domain the owner typed into a bare host, or null if it is not one. */
export function cleanDomainInput(raw: string): string | null {
  const host = normalizeHost(raw.replace(/^https?:\/\//i, '').split('/')[0])
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null
}

/** The DNS name that must carry the verification TXT record. */
export function verificationRecordName(domain: string): string {
  return `_solpawn.${domain}`
}

/** Slug of the shop that owns a verified custom domain, or null. */
export async function slugForCustomDomain(host: string): Promise<string | null> {
  const hit = cache.get(host)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.slug

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  let slug: string | null = null
  try {
    const res = await fetch(
      `${url}/rest/v1/public_custom_domains?select=slug&host=eq.${encodeURIComponent(host)}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    )
    if (res.ok) {
      const rows = (await res.json()) as Array<{ slug: string | null }>
      slug = rows[0]?.slug ?? null
    }
  } catch {
    // Network trouble: do not cache a miss we are unsure of.
    return null
  }
  cache.set(host, { slug, at: Date.now() })
  return slug
}
