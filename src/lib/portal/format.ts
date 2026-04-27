/**
 * Portal-side formatting helpers. Safe to import in either RSC or client
 * components. Money lives at numeric(18,4) on the wire — we format to 2 dp
 * for display but keep four-decimal precision internally.
 */

export function formatMoney(value: number, currency = 'USD'): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatDateUtc(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const dt = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  )
  return dt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return iso
  return dt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
