/**
 * metals.live spot-price fetcher.
 *
 * metals.live exposes a free, no-key public REST endpoint that returns the
 * latest USD per troy-ounce price for the four bullion metals we care
 * about (gold, silver, platinum, palladium). The exact JSON shape has
 * shifted over time and is not contractually stable; we defensively parse
 * a couple of known shapes and fall back to "no data" rather than crash.
 *
 * Output is the platform-wide per-troy-oz price for PURE metal (24k for
 * gold, .999 fine for silver). Conversion to per-purity / per-gram lives
 * in `refresh.ts` so the source layer stays narrow.
 *
 * Rate limit: metals.live is a generous free tier; refreshing every 15
 * minutes during US market hours is well below their request budget.
 *
 * Env / build safety:
 *   - In NODE_ENV=test we short-circuit and return null. Build/test
 *     never reaches the network.
 *   - On any non-2xx, parse failure, or network error we return null
 *     and let the caller decide (refresh.ts records 'manual' fallback).
 */

export type MetalsLiveQuote = {
  metal: 'gold' | 'silver' | 'platinum' | 'palladium'
  /** USD per troy ounce, pure metal (24k / .999 fine). */
  price_per_oz: number
  fetched_at: string
}

const PURE_METALS = ['gold', 'silver', 'platinum', 'palladium'] as const
type PureMetal = (typeof PURE_METALS)[number]

const ENDPOINTS: Record<PureMetal, string> = {
  // metals.live exposes per-metal endpoints. We hit each one and combine
  // the results. If a single metal endpoint fails, we still return
  // whatever the others succeeded on.
  gold: 'https://api.metals.live/v1/spot/gold',
  silver: 'https://api.metals.live/v1/spot/silver',
  platinum: 'https://api.metals.live/v1/spot/platinum',
  palladium: 'https://api.metals.live/v1/spot/palladium',
}

/** Default per-fetch timeout. Set short — the cron runs every 15 min and
 *  metals.live is normally sub-second; if it's slow we'd rather skip the
 *  refresh than block the cron handler. */
const FETCH_TIMEOUT_MS = 8000

/**
 * Fetch latest spot quotes for all four bullion metals.
 * Returns an array (possibly empty) of successful quotes.
 */
export async function fetchSpotQuotes(): Promise<MetalsLiveQuote[]> {
  if (process.env.NODE_ENV === 'test') return []

  const fetchedAt = new Date().toISOString()
  const tasks = PURE_METALS.map(async (metal) => {
    try {
      const price = await fetchOne(metal)
      if (price == null || !isFinite(price) || price <= 0) return null
      return { metal, price_per_oz: price, fetched_at: fetchedAt } satisfies MetalsLiveQuote
    } catch (err) {
      console.error('[metals.live] fetch error', metal, err)
      return null
    }
  })
  const results = await Promise.all(tasks)
  return results.filter((q): q is MetalsLiveQuote => q != null)
}

async function fetchOne(metal: PureMetal): Promise<number | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINTS[metal], {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      // Edge-runtime safe; the cron route runs on Node so this is fine.
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[metals.live] non-200', metal, res.status)
      return null
    }
    const json: unknown = await res.json()
    return parsePrice(json)
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      console.error('[metals.live] timeout', metal)
    } else {
      console.error('[metals.live] fetch failed', metal, err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Defensive parser. Known historical shapes:
 *   1. Plain number: 2412.50
 *   2. Object: { price: 2412.5 } | { price_per_oz: 2412.5 }
 *   3. Array tuple: [[1714214400, 2412.5], ...] (timestamp, price) most recent first
 *   4. Array of objects: [{ price: 2412.5, ... }]
 * Anything else returns null.
 */
function parsePrice(json: unknown): number | null {
  if (typeof json === 'number' && isFinite(json)) return json
  if (Array.isArray(json) && json.length > 0) {
    const first = json[0]
    if (Array.isArray(first) && typeof first[1] === 'number') return first[1]
    if (first && typeof first === 'object') {
      const obj = first as Record<string, unknown>
      const v = obj.price ?? obj.price_per_oz ?? obj.value
      if (typeof v === 'number' && isFinite(v)) return v
    }
  }
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    const v = obj.price ?? obj.price_per_oz ?? obj.value
    if (typeof v === 'number' && isFinite(v)) return v
  }
  return null
}
