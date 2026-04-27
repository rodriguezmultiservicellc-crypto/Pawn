/**
 * Tiny relative-time formatter shared across the app. Intentionally
 * dependency-free — date-fns / dayjs would be overkill for one helper.
 *
 * Output:
 *   < 60s          "12s ago"
 *   < 60m          "8m ago"
 *   < 24h          "3h ago"
 *   < 7d           "5d ago"
 *   else           locale date string (e.g. "4/26/2026")
 */
export function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const t = d.getTime()
  if (!isFinite(t)) return ''
  const diffSec = Math.max(0, (Date.now() - t) / 1000)
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`
  return d.toLocaleDateString()
}

/**
 * Absolute timestamp for tooltips. Locale-aware date + time.
 */
export function absoluteTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (!isFinite(d.getTime())) return ''
  return d.toLocaleString()
}
