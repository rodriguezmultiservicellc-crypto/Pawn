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

/**
 * Pick the most-likely MetalPurity for an inventory item based on its
 * metal type and (for gold) karat. Returns null when we can't pin it
 * down (mixed / non-precious metal types, missing karat for gold, etc).
 *
 * Mapping rules:
 *   - silver / sterling   → sterling_925 (most pawn silver is sterling)
 *   - silver fine bullion → call computeMeltValue with purity='fine' instead
 *   - platinum            → platinum_950
 *   - palladium           → palladium_950
 *   - gold + karat        → 24/22/18/14/10k bucket nearest to the karat
 *                           value; .999 fine bullion gold uses 'fine'
 *   - rose_gold/white_gold → resolved via the same karat bucket
 */
export function purityFromItem(args: {
  metal: MetalType | null | undefined
  karat: number | string | null | undefined
}): MetalPurity | null {
  const metal = args.metal
  if (!metal) return null

  const karat =
    args.karat == null
      ? null
      : typeof args.karat === 'string'
      ? parseFloat(args.karat)
      : args.karat

  if (metal === 'silver') return 'sterling_925'
  if (metal === 'platinum') return 'platinum_950'
  if (metal === 'palladium') return 'palladium_950'

  // Gold-family metals require a karat to pick a purity bucket.
  if (metal === 'gold' || metal === 'rose_gold' || metal === 'white_gold') {
    if (karat == null || !isFinite(karat)) return null
    if (karat >= 23.5) return 'pure_24k'
    if (karat >= 21) return '22k'
    if (karat >= 16) return '18k'
    if (karat >= 12) return '14k'
    if (karat >= 8) return '10k'
    return null
  }

  return null
}

/**
 * Resolve the matching pure-metal type for melt lookup. Maps rose/white
 * gold back to 'gold' since the spot price is identical (alloy color
 * varies, gold content stays the same per karat).
 */
export function meltMetalFromItem(metal: MetalType | null | undefined): MetalType | null {
  if (!metal) return null
  if (metal === 'gold' || metal === 'rose_gold' || metal === 'white_gold') return 'gold'
  if (metal === 'silver' || metal === 'platinum' || metal === 'palladium') return metal
  return null
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = (admin as any).from('spot_price_overrides')
  const { data, error } = await tbl
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

  const row = (data ?? null) as SpotPriceOverrideRow | null
  const value = row?.multiplier != null ? toMoney(row.multiplier) : 1.0
  overrideCache.set(key, { value, expiresAt: now + OVERRIDE_TTL_MS })
  return value
}
