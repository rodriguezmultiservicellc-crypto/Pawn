/**
 * refreshSpotPrices() — entry point for the cron route + the manual
 * "Refresh now" button on /staff/inventory/spot-prices.
 *
 * Pipeline:
 *   1. Fetch the four pure-metal spot quotes from metals.live.
 *   2. Expand each pure quote into per-purity rows by applying the
 *      purity multiplier (24k=1.0, 22k=22/24, 18k=18/24, 14k=14/24,
 *      10k=10/24; sterling silver = 0.925; platinum_950 = 0.95;
 *      palladium_950 = 0.95; fine = 0.999).
 *   3. Batch INSERT into spot_prices via the admin client. UNIQUE
 *      (metal_type, purity, fetched_at) makes retries idempotent.
 *
 * Returns a summary the cron route logs to audit_log + the "Refresh now"
 * button echoes to the user.
 *
 * IMPORTANT: this module is server-only. Imports the admin client which
 * carries the service-role key. Never re-export from a client file.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { r4 } from '@/lib/pawn/math'
import { fetchSpotQuotes, type MetalsLiveQuote } from './sources/metals-live'
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
const PURITY_MAP: Record<MetalsLiveQuote['metal'], Array<{ purity: MetalPurity; multiplier: number }>> = {
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

export type RefreshSummary = {
  ok: boolean
  /** Source label written to spot_prices.source for every inserted row. */
  source: 'metals.live' | 'manual'
  /** Quotes returned by the upstream (pure-metal level, before per-purity expansion). */
  quotes: number
  /** Rows attempted to insert (after per-purity expansion). */
  attempted: number
  /** Rows actually inserted (after ON CONFLICT DO NOTHING). */
  inserted: number
  /** Error message if the run aborted before insert. */
  error?: string
}

/**
 * Run a refresh end-to-end. The function is non-throwing — any upstream
 * or insert failure is captured in the returned summary so the cron
 * audit log gets a row either way.
 */
export async function refreshSpotPrices(): Promise<RefreshSummary> {
  const quotes = await fetchSpotQuotes()
  if (quotes.length === 0) {
    return {
      ok: false,
      source: 'manual',
      quotes: 0,
      attempted: 0,
      inserted: 0,
      error: 'No quotes returned from metals.live; admin can update via override UI.',
    }
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
        source: 'metals.live',
        fetched_at: q.fetched_at,
      })
    }
  }

  if (inserts.length === 0) {
    return {
      ok: false,
      source: 'metals.live',
      quotes: quotes.length,
      attempted: 0,
      inserted: 0,
      error: 'No purity rows derived from quotes.',
    }
  }

  const admin = createAdminClient()
  // Type-erase to allow upsert into a table that the generated types may
  // not yet know about (regen happens at merge). The schema is constrained
  // by the migration; this cast is a temporary aliasing hack.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spotTable = (admin as any).from('spot_prices') as {
    upsert: (
      rows: SpotPriceInsert[],
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ) => Promise<{
      data: Array<{ id: string }> | null
      error: { message: string } | null
    }>
  }
  const { data, error } = await spotTable.upsert(inserts, {
    onConflict: 'metal_type,purity,fetched_at',
    ignoreDuplicates: true,
  })

  if (error) {
    console.error('[spot-prices] insert failed', error.message)
    return {
      ok: false,
      source: 'metals.live',
      quotes: quotes.length,
      attempted: inserts.length,
      inserted: 0,
      error: error.message,
    }
  }

  // PostgREST returns inserted rows in `data` (when not RETURNING-suppressed).
  const inserted = Array.isArray(data) ? data.length : inserts.length
  return {
    ok: true,
    source: 'metals.live',
    quotes: quotes.length,
    attempted: inserts.length,
    inserted,
  }
}
