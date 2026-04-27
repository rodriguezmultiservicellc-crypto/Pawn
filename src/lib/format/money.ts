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

export function formatNumber(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

/** Convert an ISO date or timestamp to a short locale date string. */
export function shortDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (!isFinite(d.getTime())) return '—'
  return d.toLocaleDateString()
}

export function shortDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (!isFinite(d.getTime())) return '—'
  return d.toLocaleString()
}
