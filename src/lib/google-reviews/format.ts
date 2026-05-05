// src/lib/google-reviews/format.ts

/**
 * Locale-aware relative time formatter, wrapping Intl.RelativeTimeFormat.
 * `timestampSec` is Unix seconds (Google's `time` field shape).
 *
 * Pure function. `now` defaults to Date.now() but is injectable for tests.
 */
export function formatRelativeTime(
  timestampSec: number,
  locale: 'en' | 'es',
  now: number = Date.now(),
): string {
  if (!Number.isFinite(timestampSec)) return ''
  const ms = timestampSec * 1000
  const diffSec = Math.floor((now - ms) / 1000)

  if (diffSec < 60) return locale === 'es' ? 'ahora mismo' : 'just now'

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })

  if (diffSec < 60 * 60) {
    return rtf.format(-Math.floor(diffSec / 60), 'minute')
  }
  if (diffSec < 60 * 60 * 24) {
    return rtf.format(-Math.floor(diffSec / 3600), 'hour')
  }
  if (diffSec < 60 * 60 * 24 * 7) {
    return rtf.format(-Math.floor(diffSec / 86400), 'day')
  }
  if (diffSec < 60 * 60 * 24 * 30) {
    return rtf.format(-Math.floor(diffSec / (86400 * 7)), 'week')
  }
  return rtf.format(-Math.floor(diffSec / (86400 * 30)), 'month')
}

/**
 * Truncate excerpt at a word boundary, append ellipsis. Collapses
 * runs of whitespace to single spaces. Returns '' on null/undefined input.
 */
export function truncateExcerpt(text: string | null | undefined, maxChars = 140): string {
  if (!text) return ''
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed

  // Find the last word boundary at or before maxChars.
  const head = collapsed.slice(0, maxChars)
  const lastSpace = head.lastIndexOf(' ')
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head
  return cut.replace(/[.,;:!\-—]+$/, '').trim() + '…'
}

/**
 * 5-element boolean array — `true` when that star is filled. Rounds to
 * nearest integer, so 4.5 → 5 stars, 3.4 → 3 stars (no half-star
 * rendering v1; aggregate float is shown as text alongside).
 */
export function starArray(rating: number | null | undefined): boolean[] {
  if (rating == null || !Number.isFinite(rating)) {
    return [false, false, false, false, false]
  }
  const n = Math.round(rating)
  const clamped = Math.max(0, Math.min(5, n))
  return [0, 1, 2, 3, 4].map((i) => i < clamped)
}
