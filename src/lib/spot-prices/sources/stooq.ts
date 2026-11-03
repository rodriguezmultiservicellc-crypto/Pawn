/**
 * Stooq LBMA spot — LAST-RESORT provider.
 *
 * Was the primary from 2026-04-30 (replaced Yahoo futures to match Kitco
 * spot). On 2026-11-03 every variant of its CSV quote endpoint
 * (`stooq.com/q/l/`, `stooq.pl/q/l/`, with and without format flags)
 * returns HTTP 404, and the historical endpoint sits behind a JavaScript
 * proof-of-work challenge. That outage — not a bad price — is what left
 * the app on an April price for six months: every manual refresh failed
 * with "No quotes returned from Stooq" and nothing surfaced it.
 *
 * Kept in the chain in case the endpoint comes back; it costs one quick
 * 404 per run and only when both providers above it have failed.
 *
 * Stooq CSV shape (header + one data row):
 *   Symbol,Date,Time,Close
 *   XAUUSD,2026-04-30,05:42:08,4560.945
 * On an invalid symbol it returns "XAUUSD,N/D,N/D,N/D".
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
  gold: 'xauusd',
  silver: 'xagusd',
  platinum: 'xptusd',
  palladium: 'xpdusd',
}

/** Exported for unit tests. */
export function parseStooqCsv(csv: string): number | null {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const cols = lines[1].split(',')
  if (cols.length < 4) return null
  return positiveNumber(cols[3])
}

export const stooqSource: SpotSource = {
  id: 'stooq',
  label: 'Stooq',
  async fetch({ fetchedAt }): Promise<SourceFetchResult> {
    const quotes: SpotQuote[] = []
    const errors: string[] = []
    await Promise.all(
      SPOT_METALS.map(async (metal) => {
        // f=sd2t2c → Symbol, Date, Time, Close. h → header row. e=csv.
        const url = `https://stooq.com/q/l/?s=${encodeURIComponent(
          SYMBOLS[metal],
        )}&f=sd2t2c&h&e=csv`
        const res = await fetchText(url, { accept: 'text/csv,text/plain' })
        if (!res.ok) {
          errors.push(`${metal}: ${res.error}`)
          return
        }
        const price = parseStooqCsv(res.text)
        if (price == null) {
          errors.push(`${metal}: unparseable response`)
          return
        }
        quotes.push({ metal, price_per_oz: price, fetched_at: fetchedAt, source: 'stooq' })
      }),
    )
    return { quotes, errors }
  },
}
