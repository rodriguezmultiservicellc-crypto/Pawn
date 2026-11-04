import 'server-only'

import { getLatestSpotPrice } from '@/lib/spot-prices/lookup'
import { meltMetalFromItem, purityFromItem } from '@/lib/spot-prices/melt'
import { toMoney } from '@/lib/money'
import { metalLabel } from './math'
import { QUOTE_METALS, spotKey } from './metals'
import type { MetalType } from '@/types/database-aliases'

/**
 * The metal line of a quote is priced at TODAY'S SPOT — the same feed as
 * Spot Prices / Buy Outright (Phase 0 chain), per gram, for the chosen
 * metal + karat. Deliberately NOT the tenant's pay-rate override: that
 * multiplier is what the shop pays when BUYING scrap; a custom piece is
 * built from metal the shop buys at (roughly) spot.
 *
 * Saving a quote freezes the result into the line (details.spot_*) and the
 * quote header (spot_price_per_gram / spot_priced_at), so the quote does
 * not move with the market afterwards.
 */
export type MetalSpotSnapshot = {
  pricePerGram: number
  fetchedAt: string
  source: string
  /** "Gold 14k" */
  label: string
}

export async function resolveMetalSpot(args: {
  metal: string
  karat: string | null | undefined
}): Promise<MetalSpotSnapshot | null> {
  const meltMetal = meltMetalFromItem(args.metal as MetalType)
  if (!meltMetal) return null
  const purity = purityFromItem({ metal: args.metal as MetalType, karat: args.karat ?? null })
  if (!purity) return null
  const row = await getLatestSpotPrice({ metalType: meltMetal, purity })
  if (!row) return null
  return {
    pricePerGram: toMoney(row.price_per_gram),
    fetchedAt: row.fetched_at,
    source: row.source,
    label: metalLabel(args.metal, args.karat),
  }
}

/**
 * Pre-load spot per gram for every (metal, karat) the form can pick, keyed
 * by spotKey(), so the sticky footer can price live without a round-trip
 * per keystroke.
 */
export async function loadQuoteSpotMap(): Promise<Record<string, MetalSpotSnapshot>> {
  const out: Record<string, MetalSpotSnapshot> = {}
  await Promise.all(
    QUOTE_METALS.flatMap(({ metal, karats }) =>
      (karats.length ? karats : ['']).map(async (karat) => {
        const snap = await resolveMetalSpot({ metal, karat: karat || null })
        if (snap) out[spotKey(metal, karat)] = snap
      }),
    ),
  )
  return out
}
