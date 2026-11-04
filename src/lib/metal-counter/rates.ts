import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getLatestSpotPrices } from '@/lib/spot-prices/lookup'
import { spotKey } from '@/lib/spot-prices/purity'
import type { RateMaps } from './math'
import { COUNTER_COMBOS_CLIENT } from '@/lib/bench/combos'

/** Every (metal, purity) the counter can price — mirrors refresh.ts PURITY_MAP. */
export const COUNTER_COMBOS = COUNTER_COMBOS_CLIENT

/**
 * Latest spot per gram + this tenant's pay and sell multipliers, flattened
 * into plain records a client component can hold. The forms do the live
 * two-way math from these; the server actions call this again at submit
 * time to freeze spot_per_gram / rate_multiplier on the ledger rows.
 */
export async function loadRateMaps(tenantId: string): Promise<RateMaps> {
  const admin = createAdminClient()
  const [spotMap, overridesRes] = await Promise.all([
    getLatestSpotPrices(COUNTER_COMBOS),
    admin
      .from('spot_price_overrides')
      .select('metal_type, purity, multiplier, sell_multiplier')
      .eq('tenant_id', tenantId),
  ])

  const spot: Record<string, number> = {}
  for (const [key, row] of spotMap.entries()) {
    if (row?.price_per_gram != null) {
      const n = Number(row.price_per_gram)
      if (Number.isFinite(n)) spot[key] = n
    }
  }

  const pay: Record<string, number> = {}
  const sell: Record<string, number> = {}
  if (overridesRes.error) {
    console.error('[metal-counter] override load failed', overridesRes.error.message)
  }
  for (const r of overridesRes.data ?? []) {
    const key = spotKey(r.metal_type, r.purity)
    const m = Number(r.multiplier)
    if (Number.isFinite(m)) pay[key] = m
    if (r.sell_multiplier != null) {
      const s = Number(r.sell_multiplier)
      if (Number.isFinite(s)) sell[key] = s
    }
  }

  return { spot, pay, sell }
}
