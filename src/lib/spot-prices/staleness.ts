/**
 * Stale-price rule — pure, no I/O.
 *
 * A spot price older than SPOT_STALE_AFTER_HOURS is "stale": the Spot
 * Prices, Buy Outright, New Pawn Ticket and Loan Calculator screens show
 * a red banner, and issuing a buy or a loan on precious-metal items needs
 * a manager's confirmation (checked again server-side). No price at all
 * counts as stale too — there is nothing to price from.
 *
 * Why 24h: the cron runs every 15 minutes during market hours and hourly
 * otherwise, so anything past a day means the feed has been down for
 * many consecutive runs, not a single hiccup. (The April→November freeze
 * this guards against was ~18% off by the time anyone noticed.)
 */

export const SPOT_STALE_AFTER_HOURS = 24

export type SpotFreshness = {
  /** ISO timestamp of the newest spot_prices row, null when the table is empty. */
  newestFetchedAt: string | null
  /** Age in hours (fractional), null when there is no price. */
  ageHours: number | null
  stale: boolean
}

export function assessSpotFreshness(
  newestFetchedAt: string | null | undefined,
  now: number = Date.now(),
): SpotFreshness {
  if (!newestFetchedAt) return { newestFetchedAt: null, ageHours: null, stale: true }
  const t = Date.parse(newestFetchedAt)
  if (!Number.isFinite(t)) return { newestFetchedAt: null, ageHours: null, stale: true }
  const ageHours = Math.max(0, (now - t) / 3_600_000)
  return {
    newestFetchedAt,
    ageHours,
    stale: ageHours > SPOT_STALE_AFTER_HOURS,
  }
}

/** Newest `fetched_at` across a set of rows (ISO strings), or null. */
export function newestFetchedAt(
  rows: ReadonlyArray<{ fetched_at: string | null } | null | undefined>,
): string | null {
  let best: string | null = null
  let bestT = -Infinity
  for (const r of rows) {
    const v = r?.fetched_at
    if (!v) continue
    const t = Date.parse(v)
    if (Number.isFinite(t) && t > bestT) {
      bestT = t
      best = v
    }
  }
  return best
}

/** Whole-hours label for the banner, floored so 25.9h reads "25 h". */
export function staleAgeLabelHours(ageHours: number | null): number | null {
  if (ageHours == null) return null
  return Math.floor(ageHours)
}
