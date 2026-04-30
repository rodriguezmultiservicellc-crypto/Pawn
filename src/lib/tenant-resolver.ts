import { createClient } from '@/lib/supabase/server'

/**
 * Public-tenant resolver.
 *
 * Two concerns living in one file because they're inverses of each other:
 *
 *   1. extractTenantSubdomain — pure host-header parser. Given the raw
 *      Host header (`acme.pawnshop.com`) and the configured base domain
 *      (`pawnshop.com`), returns the tenant slug or null. Reserved
 *      subdomains (www / api / app / admin / portal / staff / mail) are
 *      treated as platform infrastructure and never resolve to a tenant.
 *
 *      This runs in the proxy (edge runtime) on every request — keep it
 *      pure and synchronous, no DB calls. The proxy uses the result to
 *      rewrite `acme.pawnshop.com/` → `/s/acme` so the same RSC handles
 *      both URL forms.
 *
 *   2. fetchPublicTenant — async DB fetch via the anon SSR client. RLS
 *      gates this: `tenants_public_landing_select` only exposes the row
 *      when `public_landing_enabled = TRUE AND public_slug IS NOT NULL
 *      AND is_active = TRUE`. So a missing row OR a disabled landing
 *      both return null without leaking that the slug exists.
 *
 *      Selects ONLY columns safe for unauthenticated rendering. NEVER
 *      `SELECT *` — the row contains agency_store_id, police_report_format,
 *      parent_tenant_id, and other fields that aren't intentionally public.
 */

// ── Reserved subdomains ─────────────────────────────────────────────────
//
// Platform infra paths that must never resolve to a tenant subdomain.
// Application-layer block (kept here, not in the DB regex) so we can add
// values without a migration when new infra subdomains are added.
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'portal',
  'staff',
  'mail',
  'smtp',
  'imap',
  'pop',
  'pop3',
  'ftp',
  'ssh',
  'ns',
  'ns1',
  'ns2',
  'mx',
  'mx1',
  'mx2',
  'cname',
  'dns',
  'cdn',
  'static',
  'assets',
  'media',
  'images',
  'img',
  'files',
  'storage',
  'webhook',
  'webhooks',
  'callback',
  'callbacks',
  'login',
  'auth',
  'signin',
  'signup',
  'register',
  'support',
  'help',
  'docs',
  'status',
  'health',
  'monitor',
  'monitoring',
  'metrics',
  'logs',
  'admin-portal',
  'platform',
  'dashboard',
  'settings',
  'account',
  'billing',
  'pay',
  'payments',
  'invoices',
  'public',
])

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type PublicTenant = {
  id: string
  name: string
  dba: string | null
  public_slug: string
  public_about: string | null
  public_hours: PublicHours | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  has_pawn: boolean
  has_repair: boolean
  has_retail: boolean
}

export type PublicHoursDay = {
  open: string | null
  close: string | null
  closed: boolean
}

export type PublicHours = {
  mon?: PublicHoursDay
  tue?: PublicHoursDay
  wed?: PublicHoursDay
  thu?: PublicHoursDay
  fri?: PublicHoursDay
  sat?: PublicHoursDay
  sun?: PublicHoursDay
}

/**
 * Parse a Host header and return the tenant subdomain, if any. Pure
 * function — safe to call from edge runtime.
 *
 *   extractTenantSubdomain('acme.pawnshop.com', 'pawnshop.com') === 'acme'
 *   extractTenantSubdomain('acme.staging.pawnshop.com', 'staging.pawnshop.com') === 'acme'
 *   extractTenantSubdomain('pawnshop.com', 'pawnshop.com') === null   // apex
 *   extractTenantSubdomain('www.pawnshop.com', 'pawnshop.com') === null   // reserved
 *   extractTenantSubdomain('admin.pawnshop.com', 'pawnshop.com') === null // reserved
 *   extractTenantSubdomain('localhost:3060', 'pawnshop.com') === null
 *   extractTenantSubdomain('acme.pawnshop.com', undefined) === null   // base not configured
 *   extractTenantSubdomain('acme.b.pawnshop.com', 'pawnshop.com') === null  // multi-level
 *
 * Multi-level subdomains (`acme.b.example.com` against base `example.com`)
 * are rejected — we don't want `b.example.com` style staff hosts to be
 * mistakable for tenant subdomains. Configure the base domain to the
 * full host of the staff app instead.
 */
export function extractTenantSubdomain(
  host: string | null | undefined,
  baseDomain: string | null | undefined,
): string | null {
  if (!host || !baseDomain) return null

  // Strip port (`acme.pawnshop.com:3060`).
  const hostNoPort = host.split(':')[0]?.toLowerCase().trim() ?? ''
  const base = baseDomain.toLowerCase().trim().replace(/^\./, '')

  if (!hostNoPort || !base) return null

  // Apex match.
  if (hostNoPort === base) return null

  // Must end with `.${base}`.
  const suffix = `.${base}`
  if (!hostNoPort.endsWith(suffix)) return null

  const sub = hostNoPort.slice(0, hostNoPort.length - suffix.length)

  // Multi-level subdomain (sub contains a dot) — not a tenant.
  if (sub.length === 0 || sub.includes('.')) return null

  // Same shape + reserved-name gate as the DB CHECK and the validation
  // schema. Anything that can't legally be saved as a slug can't legally
  // resolve as a tenant subdomain either.
  if (isReservedOrInvalidSlug(sub)) return null

  return sub
}

/**
 * Reserved-or-malformed slug check used by the validation schema (and
 * tests). Doesn't hit the DB — pure shape + reserved-name gate. UNIQUE
 * collisions are still surfaced by the DB write.
 */
export function isReservedOrInvalidSlug(slug: string): boolean {
  if (!SLUG_RE.test(slug)) return true
  if (slug.length < 3 || slug.length > 40) return true
  if (RESERVED_SUBDOMAINS.has(slug)) return true
  return false
}

/**
 * Public-only column set. Anything not in this list NEVER ships to an
 * unauthenticated browser. RLS is the second line of defense — this
 * SELECT list is the first.
 */
const PUBLIC_TENANT_COLUMNS =
  'id, name, dba, public_slug, public_about, public_hours, address, city, state, zip, phone, email, logo_url, has_pawn, has_repair, has_retail'

/**
 * Fetch the public tenant by slug, or null if no published landing
 * exists (slug not found OR public_landing_enabled=FALSE OR
 * is_active=FALSE — RLS filters all three identically).
 *
 * Server-side only. Uses the anon SSR client so the
 * `tenants_public_landing_select` policy gates the read.
 */
export async function fetchPublicTenant(
  slug: string,
): Promise<PublicTenant | null> {
  if (isReservedOrInvalidSlug(slug)) return null

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tenants')
    .select(PUBLIC_TENANT_COLUMNS)
    .eq('public_slug', slug)
    .maybeSingle()

  if (error || !data) return null
  // The RLS policy filters to rows where public_slug IS NOT NULL — but
  // the column type is still nullable, so narrow it here.
  if (data.public_slug === null) return null

  return {
    ...data,
    public_slug: data.public_slug,
    public_hours: normalizePublicHours(data.public_hours),
  }
}

/**
 * JSONB column comes back as `unknown` (or autogen `Json`). Validate the
 * shape at the boundary; bad data renders as no-hours rather than
 * crashing the page. Days that fail validation are dropped silently.
 */
function normalizePublicHours(raw: unknown): PublicHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: PublicHours = {}
  const days: Array<keyof PublicHours> = [
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
  ]
  for (const d of days) {
    const v = (raw as Record<string, unknown>)[d]
    if (!v || typeof v !== 'object') continue
    const day = v as Record<string, unknown>
    const closed = day.closed === true
    const open = typeof day.open === 'string' ? day.open : null
    const close = typeof day.close === 'string' ? day.close : null
    out[d] = { open, close, closed }
  }
  return Object.keys(out).length > 0 ? out : null
}
