/**
 * Melt-value computation.
 *
 * `computeMeltValue` resolves the latest spot price for a (metal, purity)
 * combo, optionally applies a per-tenant pay-rate override multiplier,
 * multiplies by the weight in grams, and returns a money number rounded
 * to 4 decimal places via the same `r4` helper used everywhere else in
 * the app (see lib/pawn/math.ts).
 *
 * Returns null when:
 *   - no spot price is available for the (metal, purity) combo
 *   - weight is missing or non-positive
 *
 * Why an override multiplier is applied here (and not at storage time):
 * spot prices update independently of overrides, and the multiplier is
 * tenant-specific. We resolve at computation time so list pages always
 * see the freshest spot price × the freshest tenant policy.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { r4, toMoney } from '@/lib/pawn/math'
import { getLatestSpotPrice } from './lookup'
import type {
  MetalPurity,
  MetalType,
  SpotPriceOverrideRow,
} from '@/types/database-aliases'

// The metal → spot-bucket mapping is pure and shared with client
// components; it lives in ./purity and is re-exported here for the
// server-side callers that always imported it from melt.
export { meltMetalFromItem, purityFromItem } from './purity'

export type MeltValueArgs = {
  metalType: MetalType
  purity: MetalPurity
  /** Item weight in grams. Coerced to number; null/undefined → no melt value. */
  weightGrams: number | string | null | undefined
  /** When provided, the tenant's spot_price_overrides multiplier is applied. */
  tenantId?: string | null
}

export type MeltValueResult = {
  /** Final melt value in USD, rounded to 4dp. */
  value: number
  /** Per-gram USD spot price used (after multiplier). */
  effectivePerGram: number
  /** Raw spot price per gram (before tenant multiplier). */
  spotPerGram: number
  /** Multiplier applied (1.0 when no override exists). */
  multiplier: number
  /** Source label from the spot_prices row. */
  source: string
  /** ISO timestamp of the spot row used. */
  fetchedAt: string
}

export async function computeMeltValue(
  args: MeltValueArgs,
): Promise<MeltValueResult | null> {
  const grams = toGrams(args.weightGrams)
  if (grams == null || grams <= 0) return null

  const spot = await getLatestSpotPrice({
    metalType: args.metalType,
    purity: args.purity,
  })
  if (!spot) return null

  const spotPerGram = toMoney(spot.price_per_gram)
  const multiplier = args.tenantId
    ? await loadTenantMultiplier(args.tenantId, args.metalType, args.purity)
    : 1.0

  const effectivePerGram = r4(spotPerGram * multiplier)
  const value = r4(effectivePerGram * grams)

  return {
    value,
    effectivePerGram,
    spotPerGram,
    multiplier: r4(multiplier),
    source: spot.source,
    fetchedAt: spot.fetched_at,
  }
}

function toGrams(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n)) return null
  return n
}

const overrideCache = new Map<
  string,
  { value: number; expiresAt: number }
>()
const OVERRIDE_TTL_MS = 5 * 60 * 1000

function overrideKey(
  tenantId: string,
  metalType: MetalType,
  purity: MetalPurity,
): string {
  return `${tenantId}::${metalType}::${purity}`
}

export function clearMeltOverrideCache(): void {
  overrideCache.clear()
}

async function loadTenantMultiplier(
  tenantId: string,
  metalType: MetalType,
  purity: MetalPurity,
): Promise<number> {
  const key = overrideKey(tenantId, metalType, purity)
  const now = Date.now()
  const hit = overrideCache.get(key)
  if (hit && hit.expiresAt > now) return hit.value

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('spot_price_overrides')
    .select('id, tenant_id, metal_type, purity, multiplier, updated_by, updated_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('metal_type', metalType)
    .eq('purity', purity)
    .maybeSingle()

  if (error) {
    console.error('[spot-prices] override lookup failed', error.message)
    overrideCache.set(key, { value: 1.0, expiresAt: now + OVERRIDE_TTL_MS })
    return 1.0
  }

  // multiplier is NUMERIC: generated types narrow to string; runtime
  // returns number. SpotPriceOverrideRow uses number.
  const row = (data ?? null) as unknown as SpotPriceOverrideRow | null
  const value = row?.multiplier != null ? toMoney(row.multiplier) : 1.0
  overrideCache.set(key, { value, expiresAt: now + OVERRIDE_TTL_MS })
  return value
}
