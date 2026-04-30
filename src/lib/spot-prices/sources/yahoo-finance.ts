/**
 * Yahoo Finance spot-price fetcher.
 *
 * Replaces the previous metals.live source — that service's TLS endpoint
 * went dead and the cron silently produced no rows. Yahoo's v8 chart
 * endpoint serves COMEX futures quotes for the four bullion metals with
 * no API key and no auth dance (the v7/quote endpoint requires a crumb;
 * v8/chart does not as of 2026-04).
 *
 * Caveat: COMEX futures are not LBMA spot. The gap is typically $5–15/oz
 * on gold (contango) — acceptable for melt-value and LTV math at the
 * tolerances Pawn operates at, where tenant overrides multiply the value
 * down by 60–85% anyway. If sub-percent accuracy ever matters, Stooq
 * (xauusd/xagusd/xptusd, CSV, no auth) returns true LBMA spot.
 *
 * Output is the platform-wide per-troy-oz price for PURE metal (24k for
 * gold, .999 fine for silver). Conversion to per-purity / per-gram lives
 * in `refresh.ts` so the source layer stays narrow.
 *
 * Env / build safety:
 *   - In NODE_ENV=test we short-circuit and return an empty array. Build/
 *     test never reaches the network.
 *   - On any non-2xx, parse failure, or network error we return null for
 *     that metal and let the caller decide.
 */

export type SpotQuote = {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium'
  /** USD per troy ounce, pure metal (24k gold / .999 silver / etc). */
  price_per_oz: number
  fetched_at: string
}

const SYMBOLS: Record<SpotQuote['metal'], string> = {
  gold: 'GC=F',
  silver: 'SI=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
}

/** Default per-fetch timeout. The cron runs every 15 min and Yahoo is
 *  normally sub-second; if it's slow we'd rather skip than block. */
const FETCH_TIMEOUT_MS = 8000

/**
 * Yahoo blocks requests with no User-Agent or generic node UAs in some
 * regions. A real browser UA keeps us out of that bucket on Vercel's
 * outbound IPs.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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
      console.error('[yahoo-finance] fetch error', metal, err)
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
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[yahoo-finance] non-200', symbol, res.status)
      return null
    }
    const json = (await res.json()) as unknown
    return parsePrice(json)
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      console.error('[yahoo-finance] timeout', symbol)
    } else {
      console.error('[yahoo-finance] fetch failed', symbol, err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Yahoo v8 chart response shape (relevant slice):
 *   { chart: { result: [ { meta: { regularMarketPrice: 4587.3, ... } } ] } }
 * Anything not matching returns null.
 */
function parsePrice(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null
  const root = json as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown } }> } }
  const meta = root.chart?.result?.[0]?.meta
  const price = meta?.regularMarketPrice
  if (typeof price === 'number' && isFinite(price)) return price
  return null
}
