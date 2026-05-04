import { createClient } from '@/lib/supabase/server'
import {
  INVENTORY_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import type {
  InventoryCategory,
  MetalType,
} from '@/types/database-aliases'

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
  public_catalog_enabled: boolean
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
  'id, name, dba, public_slug, public_about, public_hours, address, city, state, zip, phone, email, logo_url, has_pawn, has_repair, has_retail, public_catalog_enabled'

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

// ── Public catalog (Phase 10 Path A slice 2) ───────────────────────────

/**
 * Public-safe column allowlist for the catalog reads. NEVER add a column
 * here without confirming it's safe to ship to an unauthenticated browser.
 *
 * Defense-in-depth: even if the RLS policy misbehaves, this SELECT list
 * still narrows the row to the safe shape. The catalog test file
 * regression-locks the forbidden set.
 */
export const PUBLIC_CATALOG_COLUMNS =
  'id, sku, description, category, brand, model, serial_number, metal, karat, weight_grams, weight_dwt, list_price, created_at'

/**
 * Escape `%`, `_`, and `\` for use in a Postgres ILIKE pattern. The
 * caller wraps the result in `%...%`. Same shape as the staff inventory
 * page's escape (which is currently inlined; we extract it here so the
 * public path uses the same logic).
 */
export function escapeIlikeLiteral(input: string): string {
  return input.replace(/[\\%_]/g, (m) => '\\' + m)
}

export type CatalogPaginationInput = {
  total: number
  page: number
  pageSize: number
}

export type CatalogPagination = {
  page: number       // normalized (≥1)
  offset: number     // (page - 1) * pageSize
  limit: number      // == pageSize
  hasMore: boolean   // page < totalPages
  totalPages: number // ceil(total / pageSize), 0 when total=0
}

/**
 * Pure pagination math. Normalizes page=0 / negative / NaN to page=1.
 * Caps page at totalPages when given a too-large page (silent normalize
 * — friendlier than 400-ing on a probe URL).
 */
export function resolveCatalogPagination(
  input: CatalogPaginationInput,
): CatalogPagination {
  const pageSize = Math.max(1, Math.floor(input.pageSize))
  const total = Math.max(0, Math.floor(input.total))
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)

  let page = Math.floor(input.page)
  if (!Number.isFinite(page) || page < 1) page = 1
  if (totalPages > 0 && page > totalPages) page = 1

  const offset = (page - 1) * pageSize
  const hasMore = totalPages > 0 && page < totalPages

  return { page, offset, limit: pageSize, hasMore, totalPages }
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

// ── Public catalog types ───────────────────────────────────────────────

export type PublicCatalogPhoto = {
  id: string
  storage_path: string
  signed_url: string | null
  position: number
  is_primary: boolean
  caption: string | null
}

export type PublicCatalogStone = {
  count: number
  stone_type: string | null
  cut: string | null
  carat: number | null
  is_total_carat: boolean
  color: string | null
  clarity: string | null
  position: number
}

export type PublicCatalogItem = {
  id: string
  sku: string
  description: string
  category: InventoryCategory
  brand: string | null
  model: string | null
  serial_number: string | null
  metal: MetalType | null
  karat: string | null
  weight_grams: number | null
  weight_dwt: number | null
  list_price: number
  created_at: string
  // Detail variant only.
  photos?: PublicCatalogPhoto[]
  stones?: PublicCatalogStone[]
}

export type PublicCatalogListItem = PublicCatalogItem & {
  primary_photo: PublicCatalogPhoto | null
}

// ── Public catalog fetchers ────────────────────────────────────────────

/**
 * Fetch a paginated slice of the public catalog for one tenant. Returns
 * empty + total=0 when no rows pass the RLS gate (caller should call
 * notFound() at the page level only when the tenant flags themselves
 * disqualify — empty results for a published catalog should still
 * render the empty state so the customer knows to come back later).
 */
export async function fetchPublicCatalog(args: {
  tenantId: string
  page: number
  pageSize: number
  category?: InventoryCategory
  q?: string
}): Promise<{
  items: PublicCatalogListItem[]
  pagination: CatalogPagination
}> {
  const supabase = await createClient()

  // Count first, then fetch the slice with an absolute range. Two
  // queries because we need the count up front to compute valid page
  // bounds and avoid a "page > totalPages" 416 from postgrest.
  let countQuery = supabase
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', args.tenantId)
  if (args.category) countQuery = countQuery.eq('category', args.category)
  if (args.q && args.q.trim().length >= 2) {
    const escaped = escapeIlikeLiteral(args.q.trim())
    countQuery = countQuery.or(
      `description.ilike.%${escaped}%,brand.ilike.%${escaped}%,model.ilike.%${escaped}%,sku.ilike.%${escaped}%,serial_number.ilike.%${escaped}%`,
    )
  }

  const { count } = await countQuery
  const total = count ?? 0
  const pagination = resolveCatalogPagination({
    total,
    page: args.page,
    pageSize: args.pageSize,
  })

  if (total === 0) {
    return { items: [], pagination }
  }

  let listQuery = supabase
    .from('inventory_items')
    .select(PUBLIC_CATALOG_COLUMNS)
    .eq('tenant_id', args.tenantId)
    .order('created_at', { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.limit - 1)
  if (args.category) listQuery = listQuery.eq('category', args.category)
  if (args.q && args.q.trim().length >= 2) {
    const escaped = escapeIlikeLiteral(args.q.trim())
    listQuery = listQuery.or(
      `description.ilike.%${escaped}%,brand.ilike.%${escaped}%,model.ilike.%${escaped}%,sku.ilike.%${escaped}%,serial_number.ilike.%${escaped}%`,
    )
  }

  const { data: rows } = await listQuery
  const items = rows ?? []

  if (items.length === 0) {
    return { items: [], pagination }
  }

  // Pull photos for every returned item; pick the primary (or lowest
  // position) per item for the list thumbnail. One round-trip via .in().
  const ids = items.map((r) => r.id)
  const { data: photoRows } = await supabase
    .from('inventory_item_photos')
    .select('id, item_id, storage_path, position, is_primary, caption')
    .in('item_id', ids)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })

  type PhotoRow = NonNullable<typeof photoRows>[number]
  const primaryByItem = new Map<string, PhotoRow>()
  for (const p of photoRows ?? []) {
    if (!primaryByItem.has(p.item_id)) primaryByItem.set(p.item_id, p)
  }

  const signed = await Promise.all(
    items.map(async (item) => {
      const p = primaryByItem.get(item.id) ?? null
      const primary_photo: PublicCatalogPhoto | null = p
        ? {
            id: p.id,
            storage_path: p.storage_path,
            signed_url: await getSignedUrl({
              bucket: INVENTORY_PHOTOS_BUCKET,
              path: p.storage_path,
              ttlSeconds: 3600,
            }),
            position: p.position,
            is_primary: p.is_primary,
            caption: p.caption,
          }
        : null
      return shapeListItem(item, primary_photo)
    }),
  )

  return { items: signed, pagination }
}

/**
 * Fetch a single public catalog item by SKU. Returns null when no row
 * passes the RLS gate (item missing, hidden, sold, parent tenant
 * unpublished — all collapse to the same answer to avoid leaking which
 * gate failed).
 */
export async function fetchPublicCatalogItem(args: {
  tenantId: string
  sku: string
}): Promise<PublicCatalogItem | null> {
  const supabase = await createClient()

  const { data: row } = await supabase
    .from('inventory_items')
    .select(PUBLIC_CATALOG_COLUMNS)
    .eq('tenant_id', args.tenantId)
    .eq('sku', args.sku)
    .maybeSingle()

  if (!row) return null

  const id = row.id

  const [{ data: photoRows }, { data: stoneRows }] = await Promise.all([
    supabase
      .from('inventory_item_photos')
      .select('id, storage_path, position, is_primary, caption')
      .eq('item_id', id)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true }),
    supabase
      .from('inventory_item_stones')
      .select('count, stone_type, cut, carat, is_total_carat, color, clarity, position')
      .eq('item_id', id)
      .order('position', { ascending: true }),
  ])

  const photos: PublicCatalogPhoto[] = await Promise.all(
    (photoRows ?? []).map(async (p) => ({
      id: p.id,
      storage_path: p.storage_path,
      signed_url: await getSignedUrl({
        bucket: INVENTORY_PHOTOS_BUCKET,
        path: p.storage_path,
        ttlSeconds: 3600,
      }),
      position: p.position,
      is_primary: p.is_primary,
      caption: p.caption,
    })),
  )

  const stones: PublicCatalogStone[] = (stoneRows ?? []).map((s) => ({
    count: s.count,
    stone_type: s.stone_type,
    cut: s.cut,
    carat: numericOrNull(s.carat),
    is_total_carat: s.is_total_carat,
    color: s.color,
    clarity: s.clarity,
    position: s.position,
  }))

  const base = shapeListItem(row, null)
  return {
    id: base.id,
    sku: base.sku,
    description: base.description,
    category: base.category,
    brand: base.brand,
    model: base.model,
    serial_number: base.serial_number,
    metal: base.metal,
    karat: base.karat,
    weight_grams: base.weight_grams,
    weight_dwt: base.weight_dwt,
    list_price: base.list_price,
    created_at: base.created_at,
    photos,
    stones,
  }
}

function shapeListItem(
  row: {
    id: string
    sku: string
    description: string
    category: string
    brand: string | null
    model: string | null
    serial_number: string | null
    metal: string | null
    karat: string | null
    weight_grams: number | string | null
    weight_dwt: number | string | null
    list_price: number | string | null
    created_at: string
  },
  primary_photo: PublicCatalogPhoto | null,
): PublicCatalogListItem {
  // NUMERIC columns can return as string from supabase-js → coerce.
  const list_price = numericOrNull(row.list_price) ?? 0
  return {
    id: row.id,
    sku: row.sku,
    description: row.description,
    category: row.category as InventoryCategory,
    brand: row.brand,
    model: row.model,
    serial_number: row.serial_number,
    metal: (row.metal as MetalType | null) ?? null,
    karat: row.karat,
    weight_grams: numericOrNull(row.weight_grams),
    weight_dwt: numericOrNull(row.weight_dwt),
    list_price,
    created_at: row.created_at,
    primary_photo,
  }
}

function numericOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}
