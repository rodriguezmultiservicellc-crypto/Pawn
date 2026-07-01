/**
 * Repair line-item helpers — shared by the intake form (title-builder chips)
 * and the create action. Pure logic only (unit-tested in line-items.test.ts).
 *
 * A repair ticket holds one or more customer items. Each item's display title
 * is composed from structured attribute chips: item type + karat + weight (g)
 * + a free dimension (length / ring size). The composed string is stored on
 * repair_ticket_line_items.title AND, joined across items, drives the derived
 * repair_tickets.item_description snapshot.
 *
 * Canonical English labels are used when composing the stored title so a
 * ticket's item titles read the same regardless of the UI language they were
 * captured in (item titles are data snapshots, like inventory descriptions).
 */

export type ItemTypeValue =
  | 'ring'
  | 'necklace'
  | 'bracelet'
  | 'earrings'
  | 'pendant'
  | 'chain'
  | 'watch'
  | 'other'

/** Chip order + canonical English label used in the composed title. */
export const ITEM_TYPES: ReadonlyArray<{ value: ItemTypeValue; en: string }> = [
  { value: 'ring', en: 'Ring' },
  { value: 'necklace', en: 'Necklace' },
  { value: 'bracelet', en: 'Bracelet' },
  { value: 'earrings', en: 'Earrings' },
  { value: 'pendant', en: 'Pendant' },
  { value: 'chain', en: 'Chain' },
  { value: 'watch', en: 'Watch' },
  { value: 'other', en: 'Item' },
]

/** Karat / fineness chips. Stored + shown verbatim (not translated). */
export const KARAT_OPTIONS: readonly string[] = [
  '10k',
  '14k',
  '18k',
  '21k',
  '22k',
  '24k',
  '925',
  '950',
]

export function itemTypeLabelEn(value: string): string {
  return ITEM_TYPES.find((t) => t.value === value)?.en ?? 'Item'
}

/** Normalize a weight input to a compact numeric string, or '' when absent. */
export function normalizeWeightGrams(
  weight: string | number | null | undefined,
): string {
  if (weight === null || weight === undefined || weight === '') return ''
  const n = typeof weight === 'number' ? weight : parseFloat(String(weight))
  if (!isFinite(n) || n <= 0) return ''
  // Trim trailing zeros from a fixed representation (2.80 → 2.8, 3.00 → 3).
  return String(Number(n.toFixed(4)))
}

/**
 * Compose the display title from structured parts, e.g.
 *   { typeLabel: 'Necklace', karat: '14k', weightGrams: 2.8, dimension: '18"' }
 *   → 'Necklace · 14k · 2.8g · 18"'
 * Empty / missing segments are dropped. Returns '' when nothing is set.
 */
export function composeLineItemTitle(parts: {
  typeLabel?: string | null
  karat?: string | null
  weightGrams?: string | number | null
  dimension?: string | null
}): string {
  const segments: string[] = []

  const type = parts.typeLabel?.trim()
  if (type) segments.push(type)

  const karat = parts.karat?.trim()
  if (karat) segments.push(karat)

  const weight = normalizeWeightGrams(parts.weightGrams)
  if (weight) segments.push(`${weight}g`)

  const dimension = parts.dimension?.trim()
  if (dimension) segments.push(dimension)

  return segments.join(' · ')
}

/**
 * Derive the ticket-level item_description snapshot from the line items.
 * One line per item: "Title — work needed" (work omitted when blank).
 */
export function deriveItemDescription(
  items: ReadonlyArray<{ title: string; work_needed?: string | null }>,
): string {
  return items
    .map((it) => {
      const work = it.work_needed?.trim()
      return work ? `${it.title} — ${work}` : it.title
    })
    .join('\n')
}

/** Derive the ticket-level title: first item, with a "(+N)" suffix when more. */
export function deriveTicketTitle(
  items: ReadonlyArray<{ title: string }>,
): string {
  if (items.length === 0) return ''
  const first = items[0].title
  const extra = items.length - 1
  const suffix = extra > 0 ? ` (+${extra})` : ''
  return `${first.slice(0, 200 - suffix.length)}${suffix}`
}
