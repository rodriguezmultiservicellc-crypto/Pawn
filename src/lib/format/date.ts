/**
 * Calendar-date formatting for customer-facing pages (public tracking /
 * quote pages). Takes a YYYY-MM-DD and renders it in the viewer's language
 * without a timezone shift (the date is a calendar day, not an instant).
 */
export function formatCalendarDate(
  iso: string,
  lang: 'en' | 'es',
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', opts)
}
