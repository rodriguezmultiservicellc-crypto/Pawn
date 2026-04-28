import 'server-only'

import { r4 } from './math'
import {
  computeMeltValue,
  meltMetalFromItem,
  purityFromItem,
} from '@/lib/spot-prices/melt'
import type { MetalType } from '@/types/database-aliases'

/**
 * Suggested-loan calculator. Combines melt value (when metal+karat+weight
 * are present), an optional appraised value (for items with a finalized
 * appraisal), and an operator-entered estimate. Picks the HIGHEST of the
 * three as the value basis, then applies a loan-to-value percentage to
 * suggest a principal.
 *
 * Why "highest" wins: pawn shops can sell forfeited collateral, so the
 * floor is the wholesale melt-or-resale value. Operator estimate may
 * factor in stones, brand, condition that the algorithm doesn't see, so
 * we don't WANT to clamp it down. Operators stay in control — the
 * suggestion is an anchor, not a hard cap.
 *
 * Default LTV is 50%, which matches the typical FL pawn shop. Operators
 * can override per-loan or via the tenant settings (when the column is
 * added — see TODO at end).
 */

export type CollateralLoanInput = {
  metal: MetalType | null | undefined
  /** Karat (e.g. 14 for 14K). String accepted ("14", "14K"). */
  karat?: string | number | null
  weightGrams?: string | number | null
  /** Operator-entered estimate (USD). */
  estValue?: string | number | null
  /** Appraised value from a linked finalized appraisal, if any. */
  appraisedValue?: string | number | null
}

export type SuggestedRow = {
  /** Computed melt value (final, after tenant multiplier). null if metal info incomplete. */
  meltValue: number | null
  /** Operator estimate (parsed). */
  estValue: number | null
  /** Appraised value (parsed). */
  appraisedValue: number | null
  /** Highest of the three present values. 0 when nothing is computable. */
  valueBasis: number
  valueBasisSource: 'melt' | 'appraised' | 'estimated' | 'none'
  /** valueBasis × ltvFactor, rounded to 4dp. */
  suggestedPrincipal: number
  /** Per-row warnings (missing karat, no spot price, etc.). */
  warnings: string[]
}

export type SuggestedLoanResult = {
  /** Sum of every row's suggestedPrincipal. */
  totalSuggestedPrincipal: number
  /** Sum of every row's valueBasis. */
  totalValueBasis: number
  /** Effective LTV percentage applied (0-100). */
  ltvPercent: number
  rows: SuggestedRow[]
  warnings: string[]
}

const DEFAULT_LTV_PERCENT = 50

export type ComputeSuggestedLoanArgs = {
  tenantId: string
  collateral: CollateralLoanInput[]
  /** Override the default LTV. Clamped to [1, 100]. */
  ltvPercent?: number | null
}

export async function computeSuggestedLoan(
  args: ComputeSuggestedLoanArgs,
): Promise<SuggestedLoanResult> {
  const ltvPercent = clampLtv(args.ltvPercent)
  const ltvFactor = ltvPercent / 100

  const rows: SuggestedRow[] = []
  const generalWarnings: string[] = []

  for (let i = 0; i < args.collateral.length; i++) {
    const row = args.collateral[i]
    const rowOut: SuggestedRow = {
      meltValue: null,
      estValue: parseMoney(row.estValue),
      appraisedValue: parseMoney(row.appraisedValue),
      valueBasis: 0,
      valueBasisSource: 'none',
      suggestedPrincipal: 0,
      warnings: [],
    }

    const melt = await tryComputeMelt(args.tenantId, row, rowOut.warnings)
    rowOut.meltValue = melt

    const candidates: Array<{ v: number; src: SuggestedRow['valueBasisSource'] }> =
      []
    if (melt != null && melt > 0) candidates.push({ v: melt, src: 'melt' })
    if (rowOut.appraisedValue != null && rowOut.appraisedValue > 0) {
      candidates.push({ v: rowOut.appraisedValue, src: 'appraised' })
    }
    if (rowOut.estValue != null && rowOut.estValue > 0) {
      candidates.push({ v: rowOut.estValue, src: 'estimated' })
    }

    if (candidates.length === 0) {
      rowOut.warnings.push(`row_${i + 1}_no_value_basis`)
    } else {
      candidates.sort((a, b) => b.v - a.v)
      rowOut.valueBasis = candidates[0].v
      rowOut.valueBasisSource = candidates[0].src
      rowOut.suggestedPrincipal = r4(rowOut.valueBasis * ltvFactor)
    }

    rows.push(rowOut)
  }

  const totalValueBasis = r4(rows.reduce((s, r) => s + r.valueBasis, 0))
  const totalSuggestedPrincipal = r4(
    rows.reduce((s, r) => s + r.suggestedPrincipal, 0),
  )

  return {
    totalSuggestedPrincipal,
    totalValueBasis,
    ltvPercent,
    rows,
    warnings: generalWarnings,
  }
}

async function tryComputeMelt(
  tenantId: string,
  row: CollateralLoanInput,
  outWarnings: string[],
): Promise<number | null> {
  const meltMetal = meltMetalFromItem(row.metal ?? null)
  if (!meltMetal) return null

  const purity = purityFromItem({
    metal: row.metal ?? null,
    karat: row.karat ?? null,
  })
  if (!purity) {
    outWarnings.push('missing_karat_for_gold')
    return null
  }

  const result = await computeMeltValue({
    metalType: meltMetal,
    purity,
    weightGrams: row.weightGrams ?? null,
    tenantId,
  })
  if (!result) {
    outWarnings.push('no_spot_price_or_weight')
    return null
  }
  return result.value
}

function parseMoney(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v.replace(/[$,]/g, '')) : v
  if (!Number.isFinite(n)) return null
  return n
}

function clampLtv(input: number | null | undefined): number {
  if (input == null || !Number.isFinite(input)) return DEFAULT_LTV_PERCENT
  if (input < 1) return 1
  if (input > 100) return 100
  return Math.round(input * 100) / 100
}

// TODO: read default LTV from settings table once a tenant_loan_policy
// JSONB column is added. For v1 every tenant uses DEFAULT_LTV_PERCENT
// unless the operator passes one explicitly.
