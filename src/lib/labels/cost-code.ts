/**
 * Coded cost on price tags. Pure.
 *
 * Jewelers print the cost on the tag in letters so staff can see their
 * floor while haggling and customers cannot. The shop picks a ten-letter
 * word with no repeated letter; its letters stand for 1,2,…,9,0 in order.
 * With BLACKHORSE, a $1,250 cost prints as "BLKE".
 *
 * Whole dollars only — cents add length and nobody negotiates on them.
 */

export type CostCodeCheck =
  | { ok: true; word: string }
  | { ok: false; error: 'cost_code_length' | 'cost_code_letters' | 'cost_code_repeat' }

export function checkCostCodeWord(raw: string): CostCodeCheck {
  const word = raw.trim().toUpperCase()
  if (word.length !== 10) return { ok: false, error: 'cost_code_length' }
  if (!/^[A-Z]{10}$/.test(word)) return { ok: false, error: 'cost_code_letters' }
  if (new Set(word).size !== 10) return { ok: false, error: 'cost_code_repeat' }
  return { ok: true, word }
}

/** Encode a cost; null when there is no usable word or cost. */
export function encodeCost(cost: number | null | undefined, word: string | null | undefined): string | null {
  if (cost == null || !Number.isFinite(cost) || cost <= 0 || !word) return null
  const check = checkCostCodeWord(word)
  if (!check.ok) return null
  const dollars = String(Math.round(cost))
  return [...dollars]
    .map((d) => check.word[d === '0' ? 9 : Number(d) - 1])
    .join('')
}
