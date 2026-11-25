/**
 * New pawn ticket: what a piece's metal is worth.
 *
 *   value = weight (g) × spot per gram at its karat × the shop's pay percent
 *
 * The spot prices and the pay percent are the same ones Buy outright uses
 * (lib/metal-counter: spot_prices + spot_price_overrides.multiplier, set on
 * the Spot prices page; no percent set = 100%). Pure — the page loads the
 * rate maps once and the popup does the math as the clerk types.
 *
 * Spot prices come in purity buckets (gold 10 / 14 / 18 / 22 / 24K; silver
 * 925 and fine; platinum and palladium 950). A purity in between is priced
 * by its metal content from the bucket it falls in — a 12K piece is 12/14 of
 * the 14K price, 800 silver 800/925 of sterling (purityContentRatio).
 * Lending on more metal than is there is the expensive mistake.
 */

import { resolveRate, type RateMaps } from '@/lib/metal-counter/math'
import { r4 } from '@/lib/pawn/math'
import {
  isSolidMetal,
  meltMetalFromItem,
  purityContentRatio,
  purityFromItem,
} from '@/lib/spot-prices/purity'

export type ItemMetalInput = {
  metal: string | null | undefined
  karat: string | number | null | undefined
  weightGrams: string | number | null | undefined
  coating: string | null | undefined
}

export type ItemMetalValue =
  | {
      status: 'ok'
      /** Dollars, rounded to cents. */
      value: number
      grams: number
      /** Dollars per gram for this piece: spot at its karat × pay percent. */
      perGram: number
      /** The shop's pay percent of spot (100 when none is set). */
      percent: number
    }
  /** Metal, karat (gold) or weight still missing. */
  | { status: 'incomplete' }
  /** A metal that is not priced off spot (steel, tungsten, mixed…). */
  | { status: 'not_precious' }
  /** Plated / filled / vermeil / PVD: no metal value. */
  | { status: 'coated' }
  /** No spot price loaded for this metal. */
  | { status: 'no_price' }

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

export function itemMetalValue(rates: RateMaps, item: ItemMetalInput): ItemMetalValue {
  const metal = item.metal ?? ''
  if (metal === '') return { status: 'incomplete' }
  const meltMetal = meltMetalFromItem(metal)
  if (!meltMetal) return { status: 'not_precious' }
  if (!isSolidMetal(item.coating)) return { status: 'coated' }

  const purity = purityFromItem({ metal, karat: item.karat })
  const grams = num(item.weightGrams)
  if (!purity || grams == null || grams <= 0) return { status: 'incomplete' }

  const rate = resolveRate(rates, meltMetal, purity, 'pay')
  if (rate.perGram == null) return { status: 'no_price' }

  // Between two buckets (12K gold, 800 silver, 900 platinum): by its metal
  // content.
  const perGram = r4(rate.perGram * purityContentRatio(metal, item.karat, purity))
  return {
    status: 'ok',
    value: Math.round(grams * perGram * 100) / 100,
    grams,
    perGram,
    percent: Math.round(rate.multiplier * 10000) / 100,
  }
}

/** The value as the Est. value field holds it ("250.12"); '' when there is none. */
export function metalValueText(v: ItemMetalValue): string {
  return v.status === 'ok' && v.value > 0 ? v.value.toFixed(2) : ''
}

/**
 * The Est. value after a field changed.
 *
 * It follows the metal value only while the clerk has left it alone: zero
 * or empty, or still exactly the metal value from before the change. A
 * value they typed (stones, brand, a negotiated number) is theirs.
 */
export function estValueAfterChange(
  current: string,
  metalBefore: string,
  metalAfter: string,
): string {
  if (metalAfter === metalBefore) return current
  const untouched = !(parseFloat(current) > 0) || current === metalBefore
  if (!untouched) return current
  return metalAfter === '' ? '0' : metalAfter
}
