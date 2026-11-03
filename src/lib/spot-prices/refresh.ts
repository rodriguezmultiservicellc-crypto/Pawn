/**
 * refreshSpotPrices() — entry point for the cron route + the manual
 * "Refresh now" button on /inventory/spot-prices.
 *
 * Pipeline:
 *   1. Fetch the four pure-metal spot quotes through the provider chain
 *      (sources/index.ts): gold-api.com → Yahoo futures → Stooq. The first
 *      provider that returns every metal wins; gaps fall through.
 *   2. Expand each pure quote into per-purity rows by applying the purity
 *      multiplier (24k=1.0, 22k=22/24, 18k=18/24, 14k=14/24, 10k=10/24;
 *      sterling silver = 0.925; platinum_950 / palladium_950 = 0.95;
 *      fine = 0.999).
 *   3. Batch INSERT into spot_prices via the admin client. UNIQUE
 *      (metal_type, purity, fetched_at) makes retries idempotent.
 *   4. Write ONE spot_price_fetches row — success or failure — with the
 *      per-provider attempt trail, so the outage that froze prices for six
 *      months in 2026 can never again be invisible.
 *
 * Returns a summary the cron route also mirrors into audit_log and the
 * "Refresh now" button echoes to the user.
 *
 * IMPORTANT: this module is server-only. Imports the admin client which
 * carries the service-role key. Never re-export from a client file.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { r4 } from '@/lib/pawn/math'
import { fetchSpotQuotesWithFallback } from './sources'
import type { SourceAttempt, SpotMetal, SpotSourceId } from './sources/types'
import type {
  MetalPurity,
  MetalType,
  SpotPriceInsert,
} from '@/types/database-aliases'

/** Troy ounce → grams, IAU-defined. */
const GRAMS_PER_TROY_OZ = 31.1034768

/**
 * Per-purity multiplier table. Each pure metal expands into one row per
 * applicable purity. Spot prices for purities not relevant to a given
 * metal are not generated (e.g. silver doesn't get a 14k row).
 */
const PURITY_MAP: Record<SpotMetal, Array<{ purity: MetalPurity; multiplier: number }>> = {
  gold: [
    { purity: 'pure_24k', multiplier: 1.0 },
    { purity: 'fine', multiplier: 0.999 },
    { purity: '22k', multiplier: 22 / 24 },
    { purity: '18k', multiplier: 18 / 24 },
    { purity: '14k', multiplier: 14 / 24 },
    { purity: '10k', multiplier: 10 / 24 },
  ],
  silver: [
    { purity: 'fine', multiplier: 0.999 },
    { purity: 'sterling_925', multiplier: 0.925 },
  ],
  platinum: [{ purity: 'platinum_950', multiplier: 0.95 }],
  palladium: [{ purity: 'palladium_950', multiplier: 0.95 }],
}

export type RefreshTrigger = 'cron' | 'manual'

export type RefreshArgs = {
  trigger: RefreshTrigger
  /** Operator who pressed "Refresh now" — null for the cron. */
  userId?: string | null
  /** Their active tenant — attribution only; spot prices are platform-wide. */
  tenantId?: string | null
}

export type RefreshSummary = {
  ok: boolean
  /** Provider that supplied the quotes; null when every provider failed. */
  source: SpotSourceId | null
  /** Quotes returned (pure-metal level, before per-purity expansion). */
  quotes: number
  /** Rows attempted to insert (after per-purity expansion). */
  attempted: number
  /** Rows actually inserted (after ON CONFLICT DO NOTHING). */
  inserted: number
  /** Per-provider trail, in the order tried. */
  attempts: SourceAttempt[]
  /** Error message if the run produced nothing usable. */
  error?: string
  /** spot_price_fetches.id when the log row was written. */
  fetchLogId: string | null
}

/**
 * Run a refresh end-to-end. Non-throwing — any upstream or insert failure
 * is captured in the returned summary (and in the fetch log) so callers
 * always get a row either way.
 */
export async function refreshSpotPrices(args: RefreshArgs): Promise<RefreshSummary> {
  const startedAt = new Date()

  // Build/test never reaches the network.
  if (process.env.NODE_ENV === 'test') {
    return finish(args, startedAt, {
      ok: false,
      source: null,
      quotes: 0,
      attempted: 0,
      inserted: 0,
      attempts: [],
      error: 'Skipped in test environment.',
    })
  }

  const { quotes, attempts, source } = await fetchSpotQuotesWithFallback(undefined, {
    fetchedAt: startedAt.toISOString(),
  })

  if (quotes.length === 0) {
    return finish(args, startedAt, {
      ok: false,
      source: null,
      quotes: 0,
      attempted: 0,
      inserted: 0,
      attempts,
      error: describeTotalFailure(attempts),
    })
  }

  const inserts: SpotPriceInsert[] = []
  for (const q of quotes) {
    const map = PURITY_MAP[q.metal]
    if (!map) continue
    const metal_type = q.metal as MetalType
    for (const { purity, multiplier } of map) {
      const pricePerOz = r4(q.price_per_oz * multiplier)
      const pricePerGram = r4(pricePerOz / GRAMS_PER_TROY_OZ)
      inserts.push({
        metal_type,
        purity,
        price_per_gram: pricePerGram,
        price_per_troy_oz: pricePerOz,
        currency: 'USD',
        source: q.source,
        fetched_at: q.fetched_at,
      })
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('spot_prices')
    .upsert(inserts as never, {
      onConflict: 'metal_type,purity,fetched_at',
      ignoreDuplicates: true,
    })
    .select('id')

  if (error) {
    console.error('[spot-prices] insert failed', error.message)
    return finish(args, startedAt, {
      ok: false,
      source,
      quotes: quotes.length,
      attempted: inserts.length,
      inserted: 0,
      attempts,
      error: `insert failed: ${error.message}`,
    })
  }

  // PostgREST returns inserted rows in `data` (when not RETURNING-suppressed).
  const inserted = Array.isArray(data) ? data.length : inserts.length
  return finish(args, startedAt, {
    ok: true,
    source,
    quotes: quotes.length,
    attempted: inserts.length,
    inserted,
    attempts,
    // Partial coverage is still a success, but say so.
    error:
      quotes.length < 4
        ? `Only ${quotes.length} of 4 metals returned a price.`
        : undefined,
  })
}

function describeTotalFailure(attempts: SourceAttempt[]): string {
  if (attempts.length === 0) return 'No spot-price providers configured.'
  const parts = attempts.map((a) => `${a.source}: ${a.error ?? 'no quotes'}`)
  return `Every provider failed — ${parts.join(' | ')}`
}

/**
 * Write the fetch-log row and return the completed summary. Logging must
 * never break the refresh itself: a failure here is reported to the
 * console and the summary goes back with fetchLogId = null.
 */
async function finish(
  args: RefreshArgs,
  startedAt: Date,
  partial: Omit<RefreshSummary, 'fetchLogId'>,
): Promise<RefreshSummary> {
  let fetchLogId: string | null = null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('spot_price_fetches')
      .insert({
        trigger: args.trigger,
        triggered_by: args.userId ?? null,
        tenant_id: args.tenantId ?? null,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        ok: partial.ok,
        source: partial.source,
        quotes: partial.quotes,
        attempted: partial.attempted,
        inserted: partial.inserted,
        error: partial.error ?? null,
        attempts: partial.attempts as unknown as never,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[spot-prices] fetch log insert failed', error.message)
    } else {
      fetchLogId = data?.id ?? null
    }
  } catch (err) {
    console.error('[spot-prices] fetch log unexpected error', err)
  }
  return { ...partial, fetchLogId }
}
