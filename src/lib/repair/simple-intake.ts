/**
 * Pure helpers for the "Simple" view of the New repair ticket page
 * (src/app/(staff)/repair/new/simple-view.tsx). Nothing here touches the
 * DOM or the network; unit-tested in simple-intake.test.ts.
 *
 * The Simple view is a second skin over the SAME form state Classic uses —
 * these helpers only shape what the operator sees (chip labels, the
 * "Promised for Friday, Nov 13" line, the card heading). What gets stored
 * is still composed by line-items.ts so both views write identical rows.
 */

import type { ServiceType } from '@/types/database-aliases'

// ── Ready-by chips ──────────────────────────────────────────────────────────

export type ReadyByKey = 'today' | 'tomorrow' | 'threeDays' | 'oneWeek'

export const READY_BY_OFFSETS: ReadonlyArray<{ key: ReadyByKey; days: number }> =
  [
    { key: 'today', days: 0 },
    { key: 'tomorrow', days: 1 },
    { key: 'threeDays', days: 3 },
    { key: 'oneWeek', days: 7 },
  ]

/**
 * The LOCAL calendar date `days` from `base`, as YYYY-MM-DD. Built from the
 * local Y/M/D parts so a shop in New York at 9 PM gets today's date, not
 * tomorrow's UTC date.
 */
export function localDatePlusDays(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Parse YYYY-MM-DD as a LOCAL date. `new Date('2026-11-13')` would be UTC. */
export function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * "Friday, Nov 13" (long) or "Nov 13" (short) in the UI language. Returns ''
 * for anything that is not a YYYY-MM-DD date.
 */
export function formatReadyBy(
  iso: string,
  locale: string,
  style: 'long' | 'short',
): string {
  const d = parseLocalDate(iso)
  if (!d) return ''
  return d.toLocaleDateString(
    locale,
    style === 'long'
      ? { weekday: 'long', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric' },
  )
}

// ── Metal chips ─────────────────────────────────────────────────────────────
// Same stored values as Classic's KARAT_OPTIONS; only the labels differ.

export const SIMPLE_METALS_PRIMARY: readonly string[] = ['10k', '14k', '18k', '925']
export const SIMPLE_METALS_MORE: readonly string[] = ['21k', '22k', '24k', '950']

export function metalLabel(
  value: string,
  words: { silver: string; platinum: string },
): string {
  if (value === '925') return `${words.silver} 925`
  if (value === '950') return `${words.platinum} 950`
  return value
}

// ── Service chips ───────────────────────────────────────────────────────────
// Spec order. 'custom' is shown as "Other" but stored as Classic stores it.

export const SIMPLE_SERVICES: ReadonlyArray<ServiceType> = [
  'repair',
  'sizing',
  'stone_setting',
  'restring',
  'plating',
  'engraving',
  'custom',
]

// ── Size field ──────────────────────────────────────────────────────────────

export type SizeFieldKind = 'ring' | 'length' | null

/** Which label the "Length / size" box gets in Simple, or null to hide it. */
export function sizeFieldFor(itemType: string): SizeFieldKind {
  if (itemType === 'ring') return 'ring'
  if (
    itemType === 'chain' ||
    itemType === 'necklace' ||
    itemType === 'bracelet' ||
    itemType === 'nameplate'
  ) {
    return 'length'
  }
  return null
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Keep digits and the first '.', drop everything else (plain decimal box). */
export function sanitizeDecimal(raw: string): string {
  let out = ''
  let dot = false
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') out += ch
    else if ((ch === '.' || ch === ',') && !dot) {
      out += '.'
      dot = true
    }
  }
  return out
}

// ── Card heading ────────────────────────────────────────────────────────────

/**
 * The Simple card heading the spec asks for: "14k Ring · Sizing". Display
 * only — the stored line title is still composeLineItemTitle() so Classic
 * and Simple write the same row.
 */
export function simpleItemHeading(parts: {
  metal: string
  typeLabel: string
  serviceLabel: string
}): string {
  const head = [parts.metal.trim(), parts.typeLabel.trim()]
    .filter(Boolean)
    .join(' ')
  const service = parts.serviceLabel.trim()
  if (head && service) return `${head} · ${service}`
  return head || service
}
