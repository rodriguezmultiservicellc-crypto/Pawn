/**
 * Metal-counter math (Sol Pawn brief, Phase 3). Pure — shared by the Buy
 * Outright and Sell Metal forms (client) and their server actions.
 *
 * Two rates per (metal, purity), both fractions of spot:
 *   pay  — what the shop pays a seller  (spot_price_overrides.multiplier,
 *          default 1.0)
 *   sell — what the shop charges a buyer (spot_price_overrides.sell_multiplier,
 *          NULL = not configured → 1.0 and the UI says so)
 *
 * Two-way entry: grams × perGram = dollars, dollars ÷ perGram = grams.
 * Money is rounded to 4 dp like every numeric(18,4) column; grams to 4 dp
 * like inventory_items.weight_grams numeric(10,4).
 */

import { r4 } from '@/lib/pos/cart'
import { spotKey } from '@/lib/spot-prices/purity'
import type {
  MetalPurity,
  MetalType,
  PaymentMethod,
} from '@/types/database-aliases'

export type RateSide = 'pay' | 'sell'

/** Plain records the server builds and the client reads — keyed by spotKey(). */
export type RateMaps = {
  /** Raw spot USD per gram. */
  spot: Record<string, number>
  /** Pay-rate multiplier; absent = 1. */
  pay: Record<string, number>
  /** Sell-rate multiplier; absent = not configured. */
  sell: Record<string, number>
}

export type ResolvedRate = {
  spotPerGram: number | null
  multiplier: number
  /** False when the side is 'sell' and no sell rate is configured. */
  configured: boolean
  /** spot × multiplier, or null when there is no spot price. */
  perGram: number | null
}

export function resolveRate(
  maps: RateMaps,
  metal: MetalType | null,
  purity: MetalPurity | null,
  side: RateSide,
): ResolvedRate {
  if (!metal || !purity) {
    return { spotPerGram: null, multiplier: 1, configured: side === 'pay', perGram: null }
  }
  const key = spotKey(metal, purity)
  const spotPerGram = maps.spot[key] ?? null
  let multiplier = 1
  let configured = true
  if (side === 'pay') {
    multiplier = maps.pay[key] ?? 1
  } else {
    const m = maps.sell[key]
    if (m == null) {
      configured = false
    } else {
      multiplier = m
    }
  }
  const perGram = spotPerGram == null ? null : r4(spotPerGram * multiplier)
  return { spotPerGram, multiplier, configured, perGram }
}

export function dollarsFromGrams(grams: number, perGram: number): number {
  return r4(grams * perGram)
}

export function gramsFromDollars(dollars: number, perGram: number): number | null {
  if (!(perGram > 0)) return null
  return r4(dollars / perGram)
}

/** Parse a form string into a finite number, or null for blank / junk. */
export function parseNum(s: string | number | null | undefined): number | null {
  if (s == null) return null
  const n = typeof s === 'string' ? parseFloat(s) : s
  return Number.isFinite(n) ? n : null
}

/** 2-dp money string for an <input type=number>. */
export function money2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

/** Grams string for an <input type=number step=0.001> — trailing zeros trimmed. */
export function grams3(n: number): string {
  return String(Number(n.toFixed(3)))
}

export type MetalLineLike = {
  metal: MetalType | null
  purity: MetalPurity | null
  grams: number | null
  dollars: number | null
}

export type MetalGroupTotals = {
  metal: MetalType
  purity: MetalPurity
  count: number
  grams: number
  dollars: number
}

const PURITY_ORDER: ReadonlyArray<MetalPurity> = [
  'pure_24k',
  'fine',
  '22k',
  '18k',
  '14k',
  '10k',
  'sterling_925',
  'platinum_950',
  'palladium_950',
]
const METAL_ORDER: ReadonlyArray<MetalType> = ['gold', 'silver', 'platinum', 'palladium']

/**
 * Group lines by (metal, purity) with grams + dollars subtotals, in the
 * order a jeweller reads them (gold first, highest purity first). Lines
 * without a resolvable metal/purity are skipped — they're not metal.
 */
export function totalsByPurity(lines: ReadonlyArray<MetalLineLike>): MetalGroupTotals[] {
  const map = new Map<string, MetalGroupTotals>()
  for (const l of lines) {
    if (!l.metal || !l.purity) continue
    const key = spotKey(l.metal, l.purity)
    const acc = map.get(key) ?? {
      metal: l.metal,
      purity: l.purity,
      count: 0,
      grams: 0,
      dollars: 0,
    }
    acc.count += 1
    acc.grams = r4(acc.grams + (l.grams ?? 0))
    acc.dollars = r4(acc.dollars + (l.dollars ?? 0))
    map.set(key, acc)
  }
  return Array.from(map.values()).sort((a, b) => {
    const m = METAL_ORDER.indexOf(a.metal) - METAL_ORDER.indexOf(b.metal)
    if (m !== 0) return m
    return PURITY_ORDER.indexOf(a.purity) - PURITY_ORDER.indexOf(b.purity)
  })
}

export function sumGrams(lines: ReadonlyArray<{ grams: number | null }>): number {
  return r4(lines.reduce((s, l) => s + (l.grams ?? 0), 0))
}

export function sumDollars(lines: ReadonlyArray<{ dollars: number | null }>): number {
  return r4(lines.reduce((s, l) => s + (l.dollars ?? 0), 0))
}

// ── Tenders ────────────────────────────────────────────────────────────────

/** Half a cent: two 2-dp amounts that differ by less than this are equal. */
const TENDER_EPSILON = 0.005

export type Tender = { method: PaymentMethod; amount: number }

export type SplitTendersResult =
  | { ok: true; tenders: Tender[] }
  | { ok: false; error: 'mixed_amounts_required' | 'mixed_amounts_mismatch' | 'total_not_positive' }

/**
 * Turn the form's payment choice into ledger tenders. 'mixed' is a UI
 * concept — the ledger stores one row per method — so it becomes a cash
 * row plus a transfer row whose amounts must add up to the total exactly
 * (to the cent). Zero-amount parts are dropped: sale_payments.amount has a
 * CHECK (amount > 0).
 */
export function splitTenders(args: {
  method: string
  total: number
  cash: number | null | undefined
  transfer: number | null | undefined
}): SplitTendersResult {
  const total = r4(args.total)
  if (!(total > 0)) return { ok: false, error: 'total_not_positive' }

  if (args.method !== 'mixed') {
    return { ok: true, tenders: [{ method: args.method as PaymentMethod, amount: total }] }
  }
  if (args.cash == null && args.transfer == null) {
    return { ok: false, error: 'mixed_amounts_required' }
  }
  const cash = r4(Math.max(0, args.cash ?? 0))
  const transfer = r4(Math.max(0, args.transfer ?? 0))
  if (Math.abs(cash + transfer - total) >= TENDER_EPSILON) {
    return { ok: false, error: 'mixed_amounts_mismatch' }
  }
  const tenders: Tender[] = []
  if (cash > 0) tenders.push({ method: 'cash', amount: cash })
  if (transfer > 0) tenders.push({ method: 'transfer', amount: transfer })
  return { ok: true, tenders }
}

/** What is still unallocated in a mixed split — drives the form hint. */
export function mixedRemaining(total: number, cash: number | null, transfer: number | null): number {
  return r4(total - (cash ?? 0) - (transfer ?? 0))
}
