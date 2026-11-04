/**
 * Karat / alloy math (brief Phase 4.1). Pure.
 *
 * Fine-gold content of a lot: fine = weight × karat / 24.
 *
 * ALLOY DOWN — bring W grams of karat Kh down to karat Kt (Kt < Kh) by
 * adding alloy (no gold in it):
 *   fine stays W·Kh/24; new total = fine ÷ (Kt/24) = W·Kh/Kt
 *   alloy to add = W·Kh/Kt − W = W·(Kh/Kt − 1)
 *
 * RAISE KARAT — bring W grams of karat Kl up to Kt (Kt > Kl) by adding
 * pure (24k) gold x:
 *   (W·Kl/24 + x) / (W + x) = Kt/24  ⇒  x = W·(Kt − Kl) / (24 − Kt)
 *   (24k target is impossible by addition — you'd need infinite gold.)
 *
 * MIX LOTS — combined karat = Σ(wᵢ·kᵢ) / Σwᵢ; fine gold = Σ(wᵢ·kᵢ)/24.
 *
 * Weights 4 dp (grams), karats 2 dp.
 */

export type AlloyDownResult = {
  fineGoldG: number
  alloyToAddG: number
  newTotalG: number
}

export function alloyDown(weightG: number, fromKarat: number, toKarat: number): AlloyDownResult | null {
  if (!valid(weightG, fromKarat, toKarat)) return null
  if (!(toKarat < fromKarat)) return null
  const fine = r4((weightG * fromKarat) / 24)
  const newTotal = r4((weightG * fromKarat) / toKarat)
  return { fineGoldG: fine, alloyToAddG: r4(newTotal - weightG), newTotalG: newTotal }
}

export type RaiseKaratResult = {
  fineGoldG: number
  pureGoldToAddG: number
  newTotalG: number
}

export function raiseKarat(weightG: number, fromKarat: number, toKarat: number): RaiseKaratResult | null {
  if (!valid(weightG, fromKarat, toKarat)) return null
  if (!(toKarat > fromKarat) || toKarat >= 24) return null
  const fine = r4((weightG * fromKarat) / 24)
  const add = r4((weightG * (toKarat - fromKarat)) / (24 - toKarat))
  return { fineGoldG: fine, pureGoldToAddG: add, newTotalG: r4(weightG + add) }
}

export type Lot = { weightG: number; karat: number }

export type MixLotsResult = {
  totalG: number
  fineGoldG: number
  /** Resulting karat, 2 dp. */
  karat: number
  /** Purity as a fraction (0.5833 for 14k). */
  fineness: number
}

export function mixLots(lots: ReadonlyArray<Lot>): MixLotsResult | null {
  const usable = lots.filter((l) => Number.isFinite(l.weightG) && l.weightG > 0 && validKarat(l.karat))
  if (usable.length === 0) return null
  const total = r4(usable.reduce((s, l) => s + l.weightG, 0))
  const karatMass = usable.reduce((s, l) => s + l.weightG * l.karat, 0)
  const karat = Math.round((karatMass / total) * 100) / 100
  return {
    totalG: total,
    fineGoldG: r4(karatMass / 24),
    karat,
    fineness: Math.round((karat / 24) * 10000) / 10000,
  }
}

/** Fine gold in a lot — the number the refiner pays on. */
export function fineGold(weightG: number, karat: number): number | null {
  if (!valid(weightG, karat, karat)) return null
  return r4((weightG * karat) / 24)
}

function validKarat(k: number): boolean {
  return Number.isFinite(k) && k > 0 && k <= 24
}
function valid(w: number, k1: number, k2: number): boolean {
  return Number.isFinite(w) && w > 0 && validKarat(k1) && validKarat(k2)
}
function r4(n: number): number {
  return Math.round(n * 10000) / 10000
}
