/**
 * Dashboard "Live metals" data (brief Phase 4.4). Server only. Shared by the
 * dashboard page (first paint) and GET /api/spot/strip (the widget's
 * auto-refresh), so both always compute the same numbers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLatestSpotPrices, getSpotFreshness, getSpotPriceHistory } from './lookup'
import { spotKey } from './purity'
import { PURITY_MAP } from './refresh'
import { isCalcMetal } from './calculator'
import type { Database } from '@/types/database'
import type { MetalPurity, MetalType } from '@/types/database-aliases'

const GRAMS_PER_TROY_OZ = 31.1034768

/** The four headline feeds on the strip. */
const STRIP_COMBOS: ReadonlyArray<{ metalType: MetalType; purity: MetalPurity }> = [
  { metalType: 'gold', purity: 'pure_24k' },
  { metalType: 'silver', purity: 'fine' },
  { metalType: 'platinum', purity: 'platinum_950' },
  { metalType: 'palladium', purity: 'palladium_950' },
]

/** One tile on the live metals strip. */
export type MetalStripItem = {
  metal: MetalType
  purity: MetalPurity
  /** Shown price: spot per troy oz × the shop's display percent. */
  perOz: number | null
  /** Spot per troy oz at 100%. */
  spotOz: number | null
  /** Pure-metal spot per troy oz (the calculator popup's base). */
  pureOz: number | null
  /** % vs the oldest point in the last 24h; null without two points. */
  changePct: number | null
  fetchedAt: string | null
}

export type MetalsStripData = {
  metals: MetalStripItem[]
  stale: boolean
  newestFetchedAt: string | null
  /** Fraction of spot the strip shows (1 = spot). */
  displayPct: number
}

/** The shop's display percent (settings.dashboard_spot_display_pct, 0083). */
export async function loadDisplayPct(supabase: SupabaseClient<Database>, tenantId: string): Promise<number> {
  const { data } = await supabase
    .from('settings')
    .select('dashboard_spot_display_pct')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return Number(data?.dashboard_spot_display_pct ?? 1) || 1
}

/**
 * Latest price per troy ounce per metal, % change against the oldest point
 * in the last 24h, and the feed's freshness (red when stale — same 24h rule
 * as the counters, brief 0.1).
 */
export async function loadMetalsStrip(displayPct: number): Promise<MetalsStripData> {
  const [latest, history, freshness] = await Promise.all([
    getLatestSpotPrices(STRIP_COMBOS),
    getSpotPriceHistory({ windowHours: 24 }),
    getSpotFreshness(),
  ])
  const firstInWindow = new Map<string, number>()
  for (const h of history) {
    const key = spotKey(h.metal_type, h.purity)
    if (!firstInWindow.has(key)) firstInWindow.set(key, Number(h.price_per_gram))
  }
  const metals: MetalStripItem[] = STRIP_COMBOS.map(({ metalType, purity }) => {
    const key = spotKey(metalType, purity)
    const row = latest.get(key) ?? null
    const perGram = row?.price_per_gram == null ? null : Number(row.price_per_gram)
    const spotOz =
      row?.price_per_troy_oz != null
        ? Number(row.price_per_troy_oz)
        : perGram == null
          ? null
          : perGram * GRAMS_PER_TROY_OZ
    // Display only (0083); % change is unaffected.
    const perOz = spotOz == null ? null : Math.round(spotOz * displayPct * 100) / 100
    const base = firstInWindow.get(key)
    const changePct =
      perGram != null && base != null && base > 0 && Number.isFinite(base)
        ? Math.round(((perGram - base) / base) * 1000) / 10
        : null
    // The feed stores purity-expanded rows (platinum_950 = 0.95 × spot), so
    // the calculator popup gets the pure-metal spot back.
    const storeMult =
      (isCalcMetal(metalType) ? PURITY_MAP[metalType].find((p) => p.purity === purity)?.multiplier : null) ?? 1
    return {
      metal: metalType,
      purity,
      perOz,
      spotOz: spotOz == null ? null : Math.round(spotOz * 100) / 100,
      pureOz: spotOz == null ? null : Math.round((spotOz / storeMult) * 100) / 100,
      changePct,
      fetchedAt: row?.fetched_at ?? null,
    }
  })
  return { metals, stale: freshness.stale, newestFetchedAt: freshness.newestFetchedAt, displayPct }
}
