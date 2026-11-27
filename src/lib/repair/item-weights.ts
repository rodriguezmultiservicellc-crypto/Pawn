/**
 * The technician's weights on a repair item (patches/0132). Pure.
 *
 * received = what the tech weighed and read when taking the piece to the
 * bench; final = the weight when the work was done. Both are compared with
 * what came before so a difference is SHOWN (never refused): a scale that
 * disagrees with intake, a karat the clerk misread, gold added by solder.
 */

/** Grams typed by the tech: > 0, at most 4 decimals (numeric(10,4)). */
export function parseGrams(raw: unknown): number | null {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

/** A karat / purity mark as typed ("14k", "925"): trimmed, ≤ 12 chars, or null. */
export function cleanKarat(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  return s ? s.slice(0, 12) : null
}

/** Same mark, ignoring case, spaces and a trailing "k"/"kt" ("14K" = "14 kt"). */
export function sameKarat(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) =>
    (v ?? '').toLowerCase().replace(/\s+/g, '').replace(/kt?$/, '')
  return norm(a) === norm(b)
}

/**
 * Grams changed from `before` to `after`, rounded to 2 decimals; null when
 * either is missing or the change is under 0.01 g (scale noise).
 */
export function gramsChange(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null) return null
  const d = Math.round((after - before) * 100) / 100
  return Math.abs(d) < 0.01 ? null : d
}

export type ItemWeightState = {
  received_at: string | null
  final_weighed_at: string | null
}

/** Every item was weighed in by the tech (an empty list counts as done). */
export function allReceived(items: readonly ItemWeightState[]): boolean {
  return items.every((i) => i.received_at != null)
}

/** "+0.12 g" / "−0.30 g". */
export function fmtGramsChange(d: number): string {
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} g`
}
