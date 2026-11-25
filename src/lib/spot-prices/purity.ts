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
  gold: ['pure_24k', '22k', '18k', '14k', '10k'],
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

// ── Purity: one `karat` column, two ways of writing it ────────────────────
//
// Gold is written in karats (14 = 14K, 24 at most). Silver, platinum and
// palladium are written in parts per thousand (925 = sterling, 950
// platinum, 999 fine) — a "karat" of silver does not exist. Both live in the
// same `karat` column (loan_collateral_items NUMERIC(4,1) holds 999.9;
// inventory_items TEXT already kept '925'); the metal says which it is.
// Every screen, ticket and report reads it through these helpers.

/** How a metal's purity is written. */
export type PurityScale = 'karat' | 'fineness'

/**
 * Karats for the gold family and for two-tone ('mixed' — almost always
 * gold) or a metal not picked yet; parts per thousand for silver, platinum
 * and palladium; none for base metals (steel, tungsten, titanium…).
 */
export function purityScaleOf(metal: string | null | undefined): PurityScale | null {
  if (metal === 'silver' || metal === 'platinum' || metal === 'palladium') return 'fineness'
  if (
    metal == null ||
    metal === '' ||
    metal === 'gold' ||
    metal === 'rose_gold' ||
    metal === 'white_gold' ||
    metal === 'mixed'
  ) {
    return 'karat'
  }
  return null
}

/** The range a purity can be, by how it is written. */
export const PURITY_LIMITS: Readonly<Record<PurityScale, { min: number; max: number }>> = {
  karat: { min: 1, max: 24 },
  // 999.9 is the most the column holds, and as fine as metal is sold.
  fineness: { min: 100, max: 999.9 },
}

/** The choices the dropdown lists for a metal, most common first. Anything
 *  else in range is typed under "Other". */
export function purityChoicesFor(metal: string | null | undefined): ReadonlyArray<string> {
  switch (metal) {
    case 'silver':
      return ['925', '999', '900', '800']
    case 'platinum':
      return ['950', '900', '850']
    case 'palladium':
      return ['950', '500']
    default:
      return purityScaleOf(metal) === 'karat' ? ['10', '14', '18', '22', '24'] : []
  }
}

/** What a metal starts on when it is picked: what nearly all of it is.
 *  Gold has no default — 10K and 14K are both common. */
export function defaultPurityFor(metal: string | null | undefined): string {
  if (metal === 'silver') return '925'
  if (metal === 'platinum' || metal === 'palladium') return '950'
  return ''
}

const PLAIN_NUMBER = /^\d+(\.\d)?$/

/**
 * Empty is valid (not known). Otherwise a plain number, at most one decimal
 * (the column's precision), inside its metal's range. A metal with no
 * purity (steel…) takes none. "28" on gold or "14" on silver is refused.
 */
export function isValidPurity(
  metal: string | null | undefined,
  value: string | number | null | undefined,
): boolean {
  const text = value == null ? '' : String(value).trim()
  if (text === '') return true
  const scale = purityScaleOf(metal)
  if (!scale) return false
  // A number from the database ("14.0" kept as 14) or as typed.
  const n = typeof value === 'number' ? value : PLAIN_NUMBER.test(text) ? Number(text) : NaN
  if (!Number.isFinite(n) || Math.abs(Math.round(n * 10) - n * 10) > 1e-9) return false
  const { min, max } = PURITY_LIMITS[scale]
  return n >= min && n <= max
}

/**
 * A purity heard or read somewhere else (voice intake "14K", a stamp the
 * photo reader saw) as the popup keeps it: "14", "925". '' when it is not a
 * purity this metal can have.
 */
export function purityFromWords(
  metal: string | null | undefined,
  words: string | number | null | undefined,
): string {
  if (words == null) return ''
  const m = /^(\d+(?:\.\d+)?)\s*(?:k|kt|karat)?$/i.exec(String(words).trim())
  if (!m) return ''
  const value = String(Number(Number(m[1]).toFixed(1)))
  return isValidPurity(metal, value) ? value : ''
}

/** What a clerk has in a purity box is usable: empty, or a purity this
 *  metal can have ("14", "14K", "925"). */
export function isPurityInput(metal: string | null | undefined, text: string | null | undefined): boolean {
  return (text ?? '').trim() === '' || purityFromWords(metal, text) !== ''
}

/**
 * The purity after the metal changes. A new metal brings its own (silver
 * 925, platinum 950, gold blank). One the clerk chose stays while the new
 * metal can have it (14 from yellow to white gold); one the old metal filled
 * in, or one the new metal cannot have (925 on gold), is replaced.
 */
export function purityAfterMetalChange(
  oldMetal: string | null | undefined,
  newMetal: string | null | undefined,
  purity: string,
): string {
  const k = purity.trim()
  if (k === '' || k === defaultPurityFor(oldMetal) || !isPurityInput(newMetal, k)) {
    return defaultPurityFor(newMetal)
  }
  return purity
}

/** How inventory_items.karat (TEXT) keeps a purity: "14K", "925"; null
 *  for none or one the metal cannot have. Every writer of an inventory row
 *  goes through it, so the tag, the catalog and the search read one form. */
export function purityForInventory(
  metal: string | null | undefined,
  raw: string | number | null | undefined,
): string | null {
  return purityText(metal, purityFromWords(metal, raw)) || null
}

/** "14K", "925", or '' — how a purity reads on a screen, a ticket line or a
 *  description. A number the metal cannot have reads as it is, without "K". */
export function purityText(
  metal: string | null | undefined,
  value: string | number | null | undefined,
): string {
  const text = value == null ? '' : String(value).trim()
  if (text === '') return ''
  const n = typeof value === 'number' ? value : Number(text)
  if (!Number.isFinite(n) || n <= 0) return ''
  const shown = String(Number(n.toFixed(1)))
  return purityScaleOf(metal) === 'karat' && n <= PURITY_LIMITS.karat.max ? `${shown}K` : shown
}

/**
 * Pick the most-likely MetalPurity for an item from its metal and its
 * purity. Returns null when it can't be pinned down.
 *
 *   silver                → fine at 990 and up, else sterling_925 (most pawn
 *                           silver is sterling; no purity = sterling)
 *   platinum              → platinum_950
 *   palladium             → palladium_950
 *   gold family + karat   → 24 / 22 / 18 / 14 / 10k bucket nearest the karat
 *
 * A purity between buckets is priced by its metal content from the bucket
 * (`purityContentRatio`).
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

  if (metal === 'silver') {
    return karat != null && isFinite(karat) && karat >= 990 && karat <= 999.9
      ? 'fine'
      : 'sterling_925'
  }
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

/** Parts per thousand each fineness bucket is priced at. */
const BUCKET_FINENESS: Partial<Record<MetalPurity, number>> = {
  sterling_925: 925,
  fine: 999,
  platinum_950: 950,
  palladium_950: 950,
}

/**
 * How much of its bucket's metal a piece holds: a 12K piece is 12/14 of the
 * 14K price, 800 silver 800/925 of sterling, 900 platinum 900/950. 1 when
 * the purity is the bucket's own, unknown, or out of range. 24K is the top
 * gold bucket (23.5 and up), priced as it is. Lending on more metal than is
 * there is the expensive mistake.
 */
export function purityContentRatio(
  metal: string | null | undefined,
  karat: string | number | null | undefined,
  purity: MetalPurity,
): number {
  // "14", "14K" (inventory's form) or "925"; anything else is priced as its
  // bucket.
  const read = purityFromWords(metal, karat)
  if (read === '') return 1
  const n = Number(read)
  if (purityScaleOf(metal) === 'karat') {
    if (purity === 'pure_24k') return 1
    const bucket = Number(karatForPurity(purity))
    return bucket > 0 ? n / bucket : 1
  }
  const bucket = BUCKET_FINENESS[purity]
  return bucket ? n / bucket : 1
}

/** Surface coatings (patches/0067). Anything but 'none' is NOT solid metal. */
export const COATINGS = ['none', 'gold_plated', 'gold_filled', 'vermeil', 'pvd'] as const
export type Coating = (typeof COATINGS)[number]

/**
 * Melt value only exists for solid metal. A plated / filled / vermeil / PVD
 * piece has a few microns of gold over base metal — pricing it at karat
 * weight would overpay by 10-50×. NULL / unknown counts as solid (legacy
 * rows predate the column).
 */
export function isSolidMetal(coating: string | null | undefined): boolean {
  return coating == null || coating === '' || coating === 'none'
}

/** Is this purity a real bucket for this spot metal (e.g. gold + 'fine' is not)? */
export function isValidPurityForMetal(metal: string, purity: string): boolean {
  return PURITIES_BY_METAL[metal]?.includes(purity as MetalPurity) ?? false
}

/** Map key used by every spot / override lookup: `${metal}::${purity}`. */
export function spotKey(metal: MetalType, purity: MetalPurity): string {
  return `${metal}::${purity}`
}
