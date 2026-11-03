/**
 * Spot-price lookup helpers.
 *
 * `getLatestSpotPrice` returns the most-recent row for a (metal, purity)
 * combo. Used by the inventory list/detail pages and by the override UI.
 *
 * In-process 5-minute cache so list pages with many items don't hammer
 * the DB (one query per metal/purity combo); cache is busted whenever
 * the cron route or an admin's "Refresh now" button calls
 * `clearSpotPriceCache()`.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { assessSpotFreshness, type SpotFreshness } from './staleness'
import type {
  MetalPurity,
  MetalType,
  SpotPriceFetchRow,
  SpotPriceRow,
} from '@/types/database-aliases'

const CACHE_TTL_MS = 5 * 60 * 1000

type CacheEntry = {
  value: SpotPriceRow | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/** Newest fetched_at across the whole table — one query, cached like the rows. */
let newestCache: { value: string | null; expiresAt: number } | null = null

function cacheKey(metalType: MetalType, purity: MetalPurity): string {
  return `${metalType}::${purity}`
}

export function clearSpotPriceCache(): void {
  cache.clear()
  newestCache = null
}

/**
 * Is the feed fresh? Reads the single newest spot_prices row (any metal)
 * and applies the 24h rule. Pages render the stale banner from this and
 * the buy / pawn actions re-check it before accepting a submission.
 */
export async function getSpotFreshness(): Promise<SpotFreshness> {
  const now = Date.now()
  if (newestCache && newestCache.expiresAt > now) {
    return assessSpotFreshness(newestCache.value, now)
  }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('spot_prices')
    .select('fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[spot-prices] freshness lookup failed', error.message)
    // Fail closed: an unreadable feed is treated as stale, not fresh.
    return assessSpotFreshness(null, now)
  }
  const value = data?.fetched_at ?? null
  newestCache = { value, expiresAt: now + CACHE_TTL_MS }
  return assessSpotFreshness(value, now)
}

/** Most recent refresh attempts (cron + manual), newest first. */
export async function getSpotFetchLog(limit = 20): Promise<SpotPriceFetchRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('spot_price_fetches')
    .select(
      'id, trigger, triggered_by, tenant_id, started_at, finished_at, ok, source, quotes, attempted, inserted, error, attempts, created_at',
    )
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[spot-prices] fetch log read failed', error.message)
    return []
  }
  return (data ?? []) as unknown as SpotPriceFetchRow[]
}

export async function getLatestSpotPrice(args: {
  metalType: MetalType
  purity: MetalPurity
}): Promise<SpotPriceRow | null> {
  const key = cacheKey(args.metalType, args.purity)
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) return hit.value

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('spot_prices')
    .select(
      'id, metal_type, purity, price_per_gram, price_per_troy_oz, currency, source, source_request_id, fetched_at, created_at',
    )
    .eq('metal_type', args.metalType)
    .eq('purity', args.purity)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[spot-prices] lookup failed', error.message)
    cache.set(key, { value: null, expiresAt: now + CACHE_TTL_MS })
    return null
  }

  // NUMERIC columns come back as string from generated types — narrow
  // to the runtime shape (number) via the hand-rolled SpotPriceRow.
  const row = (data ?? null) as unknown as SpotPriceRow | null
  cache.set(key, { value: row, expiresAt: now + CACHE_TTL_MS })
  return row
}

/**
 * Bulk variant — returns the latest row per (metal, purity) for the
 * combos provided. Used by the spot-prices grid which renders all
 * purities at once.
 */
export async function getLatestSpotPrices(
  combos: ReadonlyArray<{ metalType: MetalType; purity: MetalPurity }>,
): Promise<Map<string, SpotPriceRow | null>> {
  const out = new Map<string, SpotPriceRow | null>()
  await Promise.all(
    combos.map(async (c) => {
      const row = await getLatestSpotPrice(c)
      out.set(cacheKey(c.metalType, c.purity), row)
    }),
  )
  return out
}

/** Read all (metal, purity, fetched_at, price_per_gram) rows in the last
 *  `windowHours` hours for sparkline / history rendering. Bypasses the
 *  per-key cache (raw history scan). */
export async function getSpotPriceHistory(args: {
  windowHours?: number
}): Promise<SpotPriceRow[]> {
  const windowHours = args.windowHours ?? 24
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('spot_prices')
    .select(
      'id, metal_type, purity, price_per_gram, price_per_troy_oz, currency, source, source_request_id, fetched_at, created_at',
    )
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: true })

  if (error) {
    console.error('[spot-prices] history failed', error.message)
    return []
  }
  return (data ?? []) as unknown as SpotPriceRow[]
}
