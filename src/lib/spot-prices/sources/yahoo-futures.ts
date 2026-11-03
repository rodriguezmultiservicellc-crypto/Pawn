/**
 * Yahoo Finance COMEX / NYMEX front-month futures — FALLBACK provider.
 *
 *   GET https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=1d
 *   {"chart":{"result":[{"meta":{"regularMarketPrice":3931.6, ...}}]}}
 *
 * Caveat, and the reason this is NOT primary: GC=F is a futures contract
 * and trades a few dollars above LBMA spot (contango). Operators who
 * compare the in-app number to Kitco noticed the gap back in 2026-04,
 * which is why Stooq spot replaced Yahoo then. A slightly-high price for
 * a few hours beats a six-month-old one, so it stays in the chain as the
 * safety net. Yahoo's spot ticker XAUUSD=X is delisted from this
 * endpoint ("No data found, symbol may be delisted").
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
  gold: 'GC=F',
  silver: 'SI=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
}

/** Exported for unit tests. */
export function parseYahooChartPrice(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null
  const chart = (json as { chart?: { result?: unknown } }).chart
  const result = chart?.result
  if (!Array.isArray(result) || result.length === 0) return null
  const meta = (result[0] as { meta?: { regularMarketPrice?: unknown } })?.meta
  return positiveNumber(meta?.regularMarketPrice)
}

export const yahooFuturesSource: SpotSource = {
  id: 'yahoo-futures',
  label: 'Yahoo Finance (futures)',
  async fetch({ fetchedAt }): Promise<SourceFetchResult> {
    const quotes: SpotQuote[] = []
    const errors: string[] = []
    await Promise.all(
      SPOT_METALS.map(async (metal) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          SYMBOLS[metal],
        )}?range=1d&interval=1d`
        const res = await fetchText(url, { accept: 'application/json' })
        if (!res.ok) {
          errors.push(`${metal}: ${res.error}`)
          return
        }
        let price: number | null = null
        try {
          price = parseYahooChartPrice(JSON.parse(res.text))
        } catch {
          price = null
        }
        if (price == null) {
          errors.push(`${metal}: unparseable response`)
          return
        }
        quotes.push({
          metal,
          price_per_oz: price,
          fetched_at: fetchedAt,
          source: 'yahoo-futures',
        })
      }),
    )
    return { quotes, errors }
  },
}
