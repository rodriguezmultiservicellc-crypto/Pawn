/**
 * Custom-piece quote arithmetic — pure, no I/O. Shared by the quote form
 * (live sticky footer), the server action (which recomputes everything it
 * is sent and trusts none of it), the PDF and the public page.
 *
 * Model: every price block is a LINE with a cost (what the shop pays out —
 * metal at spot, a wax print, a stone's cost basis, outsourced labor) and a
 * price (what the customer pays). The quote's margin is on PRICE:
 *
 *     margin = (Σ price − Σ cost) / Σ price          "you keep Σprice − Σcost"
 *
 * A target margin fills the price of every cost-bearing line that staff
 * did not type by hand: price = cost / (1 − margin). Lines with no cost
 * (bench labor at the shop's rate, an engraving fee) are pure price and
 * count fully toward "you keep".
 *
 * Money is 4-dp (numeric(18,4)); percentages are FRACTIONS (0.5 = 50%)
 * everywhere below, matching the settings columns and the DB CHECKs.
 */

import { r4 } from '@/lib/money'
import type { CustomQuoteLineKind } from '@/types/database-aliases'

export type QuoteLineCalc = {
  kind: CustomQuoteLineKind
  quantity: number
  unit_cost: number
  unit_price: number
  /** Staff typed the price — a target-margin recompute leaves it alone. */
  price_locked: boolean
}

export type QuoteLineTotals = { cost_total: number; price_total: number }

export type QuoteTotals = {
  cost: number
  price: number
  /** price − cost: what the shop keeps. */
  keep: number
  /** Fraction of price. 0 when there is no price yet. */
  marginPct: number
}

/** Hard ceiling so price = cost / (1 − m) can never divide by ~0. */
export const MAX_MARGIN_PCT = 0.95

function clampFraction(v: number, max = 1): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(max, Math.max(0, v))
}

function nonNeg(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0
}

export function lineTotals(l: Pick<QuoteLineCalc, 'quantity' | 'unit_cost' | 'unit_price'>): QuoteLineTotals {
  const q = nonNeg(l.quantity)
  return {
    cost_total: r4(q * nonNeg(l.unit_cost)),
    price_total: r4(q * nonNeg(l.unit_price)),
  }
}

export function quoteTotals(lines: ReadonlyArray<QuoteLineCalc>): QuoteTotals {
  let cost = 0
  let price = 0
  for (const l of lines) {
    const t = lineTotals(l)
    cost += t.cost_total
    price += t.price_total
  }
  cost = r4(cost)
  price = r4(price)
  const keep = r4(price - cost)
  const marginPct = price > 0 ? r4(keep / price) : 0
  return { cost, price, keep, marginPct }
}

/** Customer price for a cost at a target margin: cost / (1 − m), 4 dp. */
export function priceFromCost(unitCost: number, marginPct: number): number {
  const m = clampFraction(marginPct, MAX_MARGIN_PCT)
  return r4(nonNeg(unitCost) / (1 - m))
}

/**
 * Re-price every unlocked, cost-bearing line at the target margin. Locked
 * lines and zero-cost lines (pure price) are returned unchanged. Because
 * zero-cost lines add to price but not to cost, the resulting QUOTE margin
 * is ≥ the target — never below it.
 */
export function applyTargetMargin<T extends QuoteLineCalc>(
  lines: ReadonlyArray<T>,
  marginPct: number,
): T[] {
  return lines.map((l) => {
    if (l.price_locked || nonNeg(l.unit_cost) === 0) return l
    return { ...l, unit_price: priceFromCost(l.unit_cost, marginPct) }
  })
}

export function marginBelowMinimum(marginPct: number, minPct: number): boolean {
  return r4(marginPct) < r4(clampFraction(minPct, MAX_MARGIN_PCT))
}

/** Deposit from a percentage of the total; the balance is the remainder. */
export function depositSplit(
  total: number,
  depositPct: number,
): { deposit: number; balance: number } {
  const t = nonNeg(total)
  const deposit = r4(t * clampFraction(depositPct, 1))
  return { deposit, balance: r4(Math.max(0, t - deposit)) }
}

/** Metal line cost: grams × frozen spot per gram. */
export function metalLineCost(grams: number, spotPerGram: number): number {
  return r4(nonNeg(grams) * nonNeg(spotPerGram))
}

/** Labor: hours × rate, or a flat amount. */
export function laborPrice(args: { mode: 'hourly' | 'flat'; hours?: number; rate?: number; flat?: number }): number {
  if (args.mode === 'flat') return r4(nonNeg(args.flat ?? 0))
  return r4(nonNeg(args.hours ?? 0) * nonNeg(args.rate ?? 0))
}

/** ISO calendar date `days` after `from` (a YYYY-MM-DD or ISO timestamp). */
export function expiryDate(from: string, days: number): string {
  const base = new Date(from.length === 10 ? `${from}T00:00:00Z` : from)
  const t = base.getTime()
  if (!Number.isFinite(t)) return from.slice(0, 10)
  const d = new Date(t + Math.max(0, Math.round(days)) * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/** True when today (YYYY-MM-DD, shop-local) is past the expiry date. */
export function isExpired(expiresOn: string | null | undefined, today: string): boolean {
  if (!expiresOn) return false
  return expiresOn < today
}

/** Human label for the frozen spot line: "Gold 14k". */
export function metalLabel(metal: string, karat: string | null | undefined): string {
  const name = metal.replace(/_/g, ' ')
  const cap = name.charAt(0).toUpperCase() + name.slice(1)
  return karat ? `${cap} ${karat}k` : cap
}
