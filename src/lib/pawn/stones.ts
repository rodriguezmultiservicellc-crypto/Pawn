/**
 * Stones on a pawned piece, in boxes (patches/0106).
 *
 * Fla. Stat. § 539.001(8)(b)2.g asks the ticket for the "Gemstone
 * description, including the number of stones." The item popup takes each
 * kind of stone on its own line — how many, what, carats, color, cut,
 * clarity — and a notes line for whatever does not fit.
 *
 * Two shapes:
 *   StoneDraft   what the popup holds while the clerk types (all strings)
 *   StoredStone  what loan_collateral_items.stones keeps (numbers parsed)
 *
 * `gemstoneText` writes both as ONE line. That line is
 * loan_collateral_items.gemstone_description — what the ticket prints and
 * the police report reads — composed once by createLoanAction.
 *
 * Pure: the popup, the server action and the tests share it.
 */

export const MAX_STONES = 6

export type StoneDraft = {
  qty: string
  type: string
  carat: string
  color: string
  cut: string
  clarity: string
}

export type StoredStone = {
  /** How many of this stone; null when not counted. */
  qty: number | null
  type: string
  /** Total carats for this line; null when not known. */
  carat: number | null
  color: string
  cut: string
  clarity: string
}

type LooseStone = {
  qty?: unknown
  type?: unknown
  carat?: unknown
  color?: unknown
  cut?: unknown
  clarity?: unknown
}

export function blankStone(): StoneDraft {
  return { qty: '', type: '', carat: '', color: '', cut: '', clarity: '' }
}

const clean = (v: unknown, max: number): string =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)

function count(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(clean(v, 12))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(9999, Math.round(n))
}

function carats(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(clean(v, 12))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(99999, Math.round(n * 1000) / 1000)
}

/**
 * Whatever arrived — the popup's JSON string, a parsed array, junk — as
 * clean stored stones. Never throws. A line with no words in it (a bare
 * count or carat says nothing) is dropped; at most MAX_STONES are kept.
 */
export function normalizeStones(raw: unknown): StoredStone[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    if (raw.trim() === '') return []
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const out: StoredStone[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const s = item as LooseStone
    const stone: StoredStone = {
      qty: count(s.qty),
      type: clean(s.type, 60),
      carat: carats(s.carat),
      color: clean(s.color, 40),
      cut: clean(s.cut, 40),
      clarity: clean(s.clarity, 40),
    }
    if (stone.type === '' && stone.color === '' && stone.cut === '' && stone.clarity === '') {
      continue
    }
    out.push(stone)
    if (out.length === MAX_STONES) break
  }
  return out
}

/** One stone line: "3 diamond (round, white, 0.75 ct, VS1)". */
function stoneLine(s: StoredStone): string {
  const head = [s.qty != null ? String(s.qty) : '', s.type].filter((p) => p !== '').join(' ')
  const details = [s.cut, s.color, s.carat != null ? `${s.carat} ct` : '', s.clarity].filter(
    (p) => p !== '',
  )
  if (details.length === 0) return head
  return head === '' ? details.join(', ') : `${head} (${details.join(', ')})`
}

/**
 * The stones as one line: each stone, then the notes, joined by "; ".
 * '' when there is nothing. Takes the popup's drafts or stored stones.
 */
export function gemstoneText(
  stones: ReadonlyArray<LooseStone> | string | null | undefined,
  notes: string | null | undefined,
): string {
  const lines = normalizeStones(stones).map(stoneLine)
  const note = clean(notes ?? '', 500)
  if (note !== '') lines.push(note)
  return lines.join('; ')
}

/** Stored stones back into the popup's boxes (a piece pawned before). */
export function stonesToDrafts(raw: unknown): StoneDraft[] {
  return normalizeStones(raw).map((s) => ({
    qty: s.qty != null ? String(s.qty) : '',
    type: s.type,
    carat: s.carat != null ? String(s.carat) : '',
    color: s.color,
    cut: s.cut,
    clarity: s.clarity,
  }))
}
