/**
 * Tiny fetch wrapper shared by every spot-price provider: hard timeout,
 * no caching, a polite User-Agent, and a failure shape that is a string
 * (so it can go straight into the fetch log) instead of a thrown error.
 */

/** Providers are normally sub-second; if one is slow we'd rather fall
 *  through to the next than hold the cron. */
export const SPOT_FETCH_TIMEOUT_MS = 8000

const USER_AGENT = 'pawn-saas/1.0 (+https://pawn-three.vercel.app)'

export type HttpTextResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

export async function fetchText(
  url: string,
  opts: { accept: string; timeoutMs?: number } = { accept: '*/*' },
): Promise<HttpTextResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(
    () => ctrl.abort(),
    opts.timeoutMs ?? SPOT_FETCH_TIMEOUT_MS,
  )
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: opts.accept, 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, text: await res.text() }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      return { ok: false, error: 'timeout' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `network: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Positive finite number or null — the one validation every parser shares. */
export function positiveNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}
