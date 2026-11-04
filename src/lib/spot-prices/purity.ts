/**
 * Pure metal → spot-bucket helpers. No Supabase import, so client
 * components (Buy Outright, Sell Metal, the loan calculator) and server
 * code share ONE mapping. `lib/spot-prices/melt.ts` re-exports these for
 * its existing callers.
 */

import type { MetalPurity, MetalType } from '@/types/database-aliases'

/** Metals the counter prices off spot. Rose / white gold price as gold. */
export const PRECIOUS_METALS: ReadonlyArray<MetalType> = [
  'gold',
  'rose_gold',
  'white_gold',
  'silver',
  'platinum',
  'palladium',
]

/** Metals a scrap / bullion sale line can be — the four spot feeds. */
export const SPOT_METALS: ReadonlyArray<MetalType> = [
  'gold',
  'silver',
  'platinum',
  'palladium',
]

/** Purity buckets that exist per spot metal (mirrors refresh.ts PURITY_MAP). */
export const PURITIES_BY_METAL: Readonly<Record<string, ReadonlyArray<MetalPurity>>> = {
  gold: ['pure_24k', 'fine', '22k', '18k', '14k', '10k'],
  silver: ['fine', 'sterling_925'],
  platinum: ['platinum_950'],
  palladium: ['palladium_950'],
}

/**
 * Resolve the matching pure-metal type for a spot lookup. Rose / white
 * gold map back to 'gold' — the alloy colour changes, the gold content per
 * karat does not. Non-precious metals → null (no melt value).
 */
export function meltMetalFromItem(
  metal: MetalType | string | null | undefined,
): MetalType | null {
  if (!metal) return null
  if (metal === 'gold' || metal === 'rose_gold' || metal === 'white_gold') return 'gold'
  if (metal === 'silver' || metal === 'platinum' || metal === 'palladium') return metal
  return null
}

/**
 * Pick the most-likely MetalPurity for an item from its metal and (for
 * gold) karat. Returns null when it can't be pinned down.
 *
 *   silver                → sterling_925 (most pawn silver is sterling;
 *                           fine bullion is priced with purity='fine')
 *   platinum              → platinum_950
 *   palladium             → palladium_950
 *   gold family + karat   → 24 / 22 / 18 / 14 / 10k bucket nearest the karat
 */
export function purityFromItem(args: {
  metal: MetalType | string | null | undefined
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

/** Nominal karat label for a purity bucket — for inventory rows created from a bucket. */
export function karatForPurity(purity: MetalPurity): string | null {
  switch (purity) {
    case 'pure_24k':
    case 'fine':
      return '24'
    case '22k':
      return '22'
    case '18k':
      return '18'
    case '14k':
      return '14'
    case '10k':
      return '10'
    default:
      return null
  }
}

/** Map key used by every spot / override lookup: `${metal}::${purity}`. */
export function spotKey(metal: MetalType, purity: MetalPurity): string {
  return `${metal}::${purity}`
}
