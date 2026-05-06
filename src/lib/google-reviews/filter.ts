// src/lib/google-reviews/filter.ts
import type { GoogleReview } from './types'

const MAX_VISIBLE = 3

/**
 * Drop reviews whose `time` (Unix seconds, used as the closest thing
 * to a stable identifier in Google's payload) is in the operator's
 * hidden list. Pure function. Defensive against undefined / null.
 */
export function applyHiddenFilter(
  reviews: GoogleReview[] | undefined | null,
  hiddenTimes: number[] | undefined | null,
): GoogleReview[] {
  if (!Array.isArray(reviews)) return []
  if (!Array.isArray(hiddenTimes) || hiddenTimes.length === 0) {
    return reviews
  }
  const hiddenSet = new Set(hiddenTimes)
  return reviews.filter((r) => !hiddenSet.has(r.time))
}

/**
 * Filter reviews by min-star floor, sort newest-first, cap at 3.
 *
 * Pure function. No mutation of inputs. Defensive against undefined / NaN.
 */
export function applyMinStarFloor(
  reviews: GoogleReview[] | undefined | null,
  floor: number,
): GoogleReview[] {
  if (!Array.isArray(reviews)) return []
  const safeFloor = Number.isFinite(floor) ? Math.max(1, Math.min(5, floor)) : 4
  const survivors = reviews.filter(
    (r) => Number.isFinite(r.rating) && r.rating >= safeFloor,
  )
  // Stable sort by `time` DESC (newest first). `time` is Unix seconds.
  survivors.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  return survivors.slice(0, MAX_VISIBLE)
}

/**
 * Encodes Decision 4 (silent fail-soft) in one place. Widget renders
 * iff we have a successful fetch AND at least one review surviving the
 * min-star filter.
 */
export function isWidgetRenderable(opts: {
  fetchedAt: Date | null
  filteredReviews: GoogleReview[]
}): boolean {
  return opts.fetchedAt !== null && opts.filteredReviews.length >= 1
}
