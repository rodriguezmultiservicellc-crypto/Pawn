/**
 * Dashboard metal calculator (the Live metals popup). Pure.
 *
 * value = weight in troy oz × pure spot per troy oz × fineness × percent
 *
 * The spot feed stores purity-expanded rows (refresh.ts PURITY_MAP), so the
 * caller passes the PURE-metal spot (stored price ÷ that row's multiplier).
 * Display only — buy / sell / melt keep using spot_price_overrides.
 */

import { GRAMS_PER, type WeightUnit } from '@/lib/bench/weight'
import type { SpotMetal } from './sources/types'

export const CALC_METALS: ReadonlyArray<SpotMetal> = ['gold', 'silver', 'platinum', 'palladium']

export function isCalcMetal(m: string): m is SpotMetal {
  return (CALC_METALS as ReadonlyArray<string>).includes(m)
}

export type CalcRow = {
  /** i18n key under dashboard.calc.rows */
  key: string
  fineness: number
}

/** Rows per metal, lowest fineness first (how counters read a karat list). */
export const CALC_ROWS: Readonly<Record<SpotMetal, ReadonlyArray<CalcRow>>> = {
  gold: [
    { key: 'k9', fineness: 9 / 24 },
    { key: 'k10', fineness: 10 / 24 },
    { key: 'k12', fineness: 12 / 24 },
    { key: 'k14', fineness: 14 / 24 },
    { key: 'k16', fineness: 16 / 24 },
    { key: 'k18', fineness: 18 / 24 },
    { key: 'k21', fineness: 21 / 24 },
    { key: 'coin900', fineness: 0.9 },
    { key: 'k22', fineness: 22 / 24 },
    { key: 'k24', fineness: 0.999 },
  ],
  silver: [
    { key: 's800', fineness: 0.8 },
    { key: 's900', fineness: 0.9 },
    { key: 's925', fineness: 0.925 },
    { key: 's999', fineness: 0.999 },
  ],
  platinum: [
    { key: 'p850', fineness: 0.85 },
    { key: 'p900', fineness: 0.9 },
    { key: 'p950', fineness: 0.95 },
    { key: 'p999', fineness: 0.999 },
  ],
  palladium: [
    { key: 'pd500', fineness: 0.5 },
    { key: 'pd950', fineness: 0.95 },
    { key: 'pd999', fineness: 0.999 },
  ],
}

export const CALC_UNITS: ReadonlyArray<WeightUnit> = ['ozt', 'g', 'dwt']

/** Parse a typed weight / percent; null for blank, junk or negative. */
export function parseAmount(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Dollar value of one row, rounded to cents; null when anything is missing. */
export function calcValue(
  weight: number | null,
  unit: WeightUnit,
  pureSpotOz: number | null,
  fineness: number,
  percent: number | null,
): number | null {
  if (weight == null || pureSpotOz == null || percent == null) return null
  const ozt = (weight * GRAMS_PER[unit]) / GRAMS_PER.ozt
  const v = ozt * pureSpotOz * fineness * (percent / 100)
  return Math.round(v * 100) / 100
}
