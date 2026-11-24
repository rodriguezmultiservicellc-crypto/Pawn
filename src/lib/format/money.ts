/**
 * Money formatter — locale-aware USD with 2 decimals. Used across all
 * report renderers (UI, PDF, CSV) so per-row presentation is consistent.
 */

export function formatMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatPercent(decimal: number | null | undefined): string {
  if (decimal == null || !isFinite(decimal)) return '—'
  return `${(decimal * 100).toFixed(2)}%`
}

/** A stored fraction as the percent a person reads and types: 0.125 → "12.5". */
export function fractionToPercent(fraction: number): string {
  return String(Math.round(fraction * 10000) / 100)
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

/**
 * Convert an ISO date or timestamp to a short locale date string.
 *
 * A bare date ("2026-08-22": an issue date, a due date) is a calendar day,
 * not an instant. `new Date('2026-08-22')` is midnight UTC, which west of
 * Greenwich is still the evening of the 21st — every such date printed one
 * day early. A bare date is read as that calendar day; a timestamp is shown
 * in the viewer's timezone as before.
 */
export function shortDate(s: string | null | undefined): string {
  if (!s) return '—'
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const d = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(s)
  if (!isFinite(d.getTime())) return '—'
  return d.toLocaleDateString()
}

export function shortDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (!isFinite(d.getTime())) return '—'
  return d.toLocaleString()
}
