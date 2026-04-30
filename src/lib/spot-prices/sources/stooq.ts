/**
 * Stooq spot-price fetcher.
 *
 * Replaces Yahoo Finance — Yahoo's v8/chart endpoint serves COMEX
 * futures (GC=F), which trade ~$5–15/oz above LBMA spot due to contango.
 * Operators reported the gap when comparing the in-app number to Kitco
 * (which displays spot). Yahoo's spot ticker XAUUSD=X is delisted from
 * the v8/chart endpoint as of 2026-04 ("symbol may be delisted").
 *
 * Stooq exposes XAU/USD, XAG/USD, XPT/USD, XPD/USD as CSV with no auth,
 * no API key, no User-Agent dance. Their feed is the LBMA OTC reference
 * — the same number Kitco displays, typically within pennies.
 *
 * Output is the platform-wide per-troy-oz price for PURE metal (24k for
 * gold, .999 fine for silver). Conversion to per-purity / per-gram lives
 * in `refresh.ts` so the source layer stays narrow.
 *
 * Env / build safety:
 *   - In NODE_ENV=test we short-circuit and return an empty array.
 *     Build/test never reaches the network.
 *   - On any non-2xx, parse failure, or network error we return null
 *     for that metal and let the caller decide.
 */

export type SpotQuote = {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium'
  /** USD per troy ounce, pure metal — true LBMA spot. */
  price_per_oz: number
  fetched_at: string
}

const SYMBOLS: Record<SpotQuote['metal'], string> = {
  gold: 'xauusd',
  silver: 'xagusd',
  platinum: 'xptusd',
  palladium: 'xpdusd',
}

/** Default per-fetch timeout. The cron runs every 15 min and Stooq is
 *  normally sub-second; if it's slow we'd rather skip than block. */
const FETCH_TIMEOUT_MS = 8000

/** Polite UA — Stooq doesn't require it but won't reject it either. */
const USER_AGENT = 'pawn-saas/1.0 (+https://pawn-three.vercel.app)'

/**
 * Fetch latest spot quotes for all four bullion metals.
 * Returns an array (possibly empty) of successful quotes. The caller
 * (refresh.ts) treats an empty array as "no rows to insert this run".
 */
export async function fetchSpotQuotes(): Promise<SpotQuote[]> {
  if (process.env.NODE_ENV === 'test') return []

  // Single timestamp shared across all four fetches so the UNIQUE
  // (metal_type, purity, fetched_at) constraint groups one refresh
  // into one logical batch.
  const fetchedAt = new Date().toISOString()
  const entries = Object.entries(SYMBOLS) as Array<[SpotQuote['metal'], string]>
  const tasks = entries.map(async ([metal, symbol]) => {
    try {
      const price = await fetchOne(symbol)
      if (price == null || !isFinite(price) || price <= 0) return null
      return { metal, price_per_oz: price, fetched_at: fetchedAt } satisfies SpotQuote
    } catch (err) {
      console.error('[stooq] fetch error', metal, err)
      return null
    }
  })
  const results = await Promise.all(tasks)
  return results.filter((q): q is SpotQuote => q != null)
}

async function fetchOne(symbol: string): Promise<number | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    // f=sd2t2c → Symbol, Date, Time, Close (4 cols).
    // h        → include header row.
    // e=csv    → CSV format.
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2c&h&e=csv`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/csv,text/plain',
        'User-Agent': USER_AGENT,
      },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[stooq] non-200', symbol, res.status)
      return null
    }
    const text = await res.text()
    return parsePrice(text)
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      console.error('[stooq] timeout', symbol)
    } else {
      console.error('[stooq] fetch failed', symbol, err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Stooq CSV shape (header + one data row):
 *   Symbol,Date,Time,Close
 *   XAUUSD,2026-04-30,05:42:08,4560.945
 *
 * On invalid symbol Stooq returns "Symbol,...\nXAUUSD,N/D,N/D,N/D" —
 * parseFloat('N/D') yields NaN which we filter out.
 */
function parsePrice(csv: string): number | null {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const cols = lines[1].split(',')
  if (cols.length < 4) return null
  const price = parseFloat(cols[3])
  if (!isFinite(price) || price <= 0) return null
  return price
}
