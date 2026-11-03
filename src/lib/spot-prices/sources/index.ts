/**
 * Provider chain. Tries each source in order; the first one that returns
 * every metal wins. If none does, the gaps are filled metal-by-metal from
 * whichever provider had that metal first, so one flaky symbol can't
 * freeze the whole feed. Every attempt — success or failure — is returned
 * for the fetch log.
 */

import { goldApiSource } from './gold-api'
import { stooqSource } from './stooq'
import { yahooFuturesSource } from './yahoo-futures'
import {
  SPOT_METALS,
  type SourceAttempt,
  type SpotMetal,
  type SpotQuote,
  type SpotSource,
  type SpotSourceId,
} from './types'

/** Order matters: spot before futures, dead-as-of-2026-11 provider last. */
export const SPOT_SOURCES: ReadonlyArray<SpotSource> = [
  goldApiSource,
  yahooFuturesSource,
  stooqSource,
]

export type FallbackFetchResult = {
  quotes: SpotQuote[]
  attempts: SourceAttempt[]
  /** Provider that supplied the most metals (the "winner"), null when none returned anything. */
  source: SpotSourceId | null
}

export async function fetchSpotQuotesWithFallback(
  sources: ReadonlyArray<SpotSource> = SPOT_SOURCES,
  opts: { fetchedAt?: string; now?: () => number } = {},
): Promise<FallbackFetchResult> {
  // One timestamp shared across every provider and metal so the
  // UNIQUE(metal_type, purity, fetched_at) constraint groups a refresh
  // into one logical batch.
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString()
  const now = opts.now ?? Date.now

  const byMetal = new Map<SpotMetal, SpotQuote>()
  const attempts: SourceAttempt[] = []

  for (const src of sources) {
    const started = now()
    let result: { quotes: SpotQuote[]; errors: string[] }
    try {
      result = await src.fetch({ fetchedAt })
    } catch (err) {
      // Providers are contracted not to throw; treat it like a full miss.
      result = {
        quotes: [],
        errors: [`unexpected: ${err instanceof Error ? err.message : String(err)}`],
      }
    }
    const ms = Math.max(0, now() - started)

    for (const q of result.quotes) {
      if (!byMetal.has(q.metal)) byMetal.set(q.metal, q)
    }
    const complete = SPOT_METALS.every((m) =>
      result.quotes.some((q) => q.metal === m),
    )
    attempts.push({
      source: src.id,
      ok: complete,
      quotes: result.quotes.length,
      ms,
      error: result.errors.length ? result.errors.join('; ') : null,
    })
    if (complete) break
  }

  const quotes = SPOT_METALS.map((m) => byMetal.get(m)).filter(
    (q): q is SpotQuote => q != null,
  )
  return { quotes, attempts, source: pickWinner(quotes) }
}

function pickWinner(quotes: SpotQuote[]): SpotSourceId | null {
  if (quotes.length === 0) return null
  const counts = new Map<SpotSourceId, number>()
  for (const q of quotes) counts.set(q.source, (counts.get(q.source) ?? 0) + 1)
  let best: SpotSourceId | null = null
  let bestN = -1
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id
      bestN = n
    }
  }
  return best
}
