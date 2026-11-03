/**
 * gold-api.com — PRIMARY spot-price provider.
 *
 * Free JSON endpoint, no key, no auth, CORS open. Serves the spot price
 * (not futures) for XAU / XAG / XPT / XPD in USD per troy ounce:
 *
 *   GET https://api.gold-api.com/price/XAU
 *   {"currency":"USD","name":"Gold","price":3921.19,"symbol":"XAU",
 *    "updatedAt":"2026-11-03T20:40:57Z", ...}
 *
 * Chosen 2026-11-03 after Stooq's CSV endpoint started returning 404 for
 * every symbol (see stooq.ts). Verified against Yahoo's GC=F the same day:
 * within ~$10/oz, the usual futures-vs-spot gap.
 */

import { fetchText, positiveNumber } from './http'
import {
  SPOT_METALS,
  type SourceFetchResult,
  type SpotMetal,
  type SpotQuote,
  type SpotSource,
} from './types'

const SYMBOLS: Record<SpotMetal, string> = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  palladium: 'XPD',
}

/** Exported for unit tests. */
export function parseGoldApiPrice(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null
  return positiveNumber((json as { price?: unknown }).price)
}

export const goldApiSource: SpotSource = {
  id: 'gold-api',
  label: 'gold-api.com',
  async fetch({ fetchedAt }): Promise<SourceFetchResult> {
    const quotes: SpotQuote[] = []
    const errors: string[] = []
    await Promise.all(
      SPOT_METALS.map(async (metal) => {
        const res = await fetchText(
          `https://api.gold-api.com/price/${SYMBOLS[metal]}`,
          { accept: 'application/json' },
        )
        if (!res.ok) {
          errors.push(`${metal}: ${res.error}`)
          return
        }
        let price: number | null = null
        try {
          price = parseGoldApiPrice(JSON.parse(res.text))
        } catch {
          price = null
        }
        if (price == null) {
          errors.push(`${metal}: unparseable response`)
          return
        }
        quotes.push({ metal, price_per_oz: price, fetched_at: fetchedAt, source: 'gold-api' })
      }),
    )
    return { quotes, errors }
  },
}
