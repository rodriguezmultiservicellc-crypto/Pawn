/**
 * Weight-unit conversions (brief Phase 4.1). Pure.
 *
 *   1 pennyweight (dwt)      = 1.55517384 g   (1/20 troy ounce)
 *   1 troy ounce (ozt)       = 31.1034768 g   (exact)
 *   1 avoirdupois ounce (oz) = 28.349523125 g (exact)
 *
 * Everything converts through grams, rounded to 4 dp like
 * inventory_items.weight_grams numeric(10,4).
 */

export type WeightUnit = 'g' | 'dwt' | 'ozt' | 'oz'

export const GRAMS_PER: Readonly<Record<WeightUnit, number>> = {
  g: 1,
  dwt: 1.55517384,
  ozt: 31.1034768,
  oz: 28.349523125,
}

export const WEIGHT_UNITS: ReadonlyArray<WeightUnit> = ['g', 'dwt', 'ozt', 'oz']

export function toGrams(value: number, unit: WeightUnit): number {
  return r4(value * GRAMS_PER[unit])
}

export function fromGrams(grams: number, unit: WeightUnit): number {
  return r4(grams / GRAMS_PER[unit])
}

export type WeightAll = Record<WeightUnit, number>

/** One value on one unit → all four units. Null for junk / negative. */
export function convertWeight(value: number, unit: WeightUnit): WeightAll | null {
  if (!Number.isFinite(value) || value < 0) return null
  const g = toGrams(value, unit)
  return {
    g,
    dwt: fromGrams(g, 'dwt'),
    ozt: fromGrams(g, 'ozt'),
    oz: fromGrams(g, 'oz'),
  }
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000
}
