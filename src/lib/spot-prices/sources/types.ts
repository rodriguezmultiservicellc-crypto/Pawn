/**
 * Shared shapes for the spot-price provider chain.
 *
 * A provider ("source") fetches the pure-metal LBMA-style spot price per
 * troy ounce for the four bullion metals. Providers never throw — every
 * failure is reported in `errors` so the caller (sources/index.ts) can
 * fall through to the next provider and the fetch log records exactly
 * what happened on each attempt.
 */

export type SpotMetal = 'gold' | 'silver' | 'platinum' | 'palladium'

export const SPOT_METALS: ReadonlyArray<SpotMetal> = [
  'gold',
  'silver',
  'platinum',
  'palladium',
]

/** Provider identifiers — written verbatim to `spot_prices.source`. */
export type SpotSourceId = 'gold-api' | 'yahoo-futures' | 'stooq'

export type SpotQuote = {
  metal: SpotMetal
  /** USD per troy ounce, pure metal. */
  price_per_oz: number
  /** Shared timestamp for the whole refresh batch (ISO). */
  fetched_at: string
  /** Which provider produced this quote. */
  source: SpotSourceId
}

export type SourceFetchResult = {
  quotes: SpotQuote[]
  /** One human-readable line per metal that failed (`gold: HTTP 404`). */
  errors: string[]
}

export type SpotSource = {
  id: SpotSourceId
  /** Short label for the fetch log / UI. */
  label: string
  /**
   * Fetch all four metals. Must resolve (never reject) — partial results
   * are fine, the chain fills gaps from the next provider.
   */
  fetch(args: { fetchedAt: string }): Promise<SourceFetchResult>
}

/** One row of the per-fetch attempt trail stored in `spot_price_fetches.attempts`. */
export type SourceAttempt = {
  source: SpotSourceId
  /** true when this provider returned every metal. */
  ok: boolean
  quotes: number
  ms: number
  error: string | null
}
