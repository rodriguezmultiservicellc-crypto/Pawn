'use server'

import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  computeSuggestedLoan,
  type CollateralLoanInput,
  type SuggestedLoanResult,
} from '@/lib/pawn/suggested-loan'
import type { MetalType } from '@/types/database-aliases'

const VALID_METALS: ReadonlyArray<MetalType> = [
  'gold',
  'silver',
  'platinum',
  'palladium',
  'rose_gold',
  'white_gold',
  'tungsten',
  'titanium',
  'stainless_steel',
  'mixed',
  'none',
  'other',
]

export type CalculatorState =
  | { status: 'idle' }
  | { status: 'error'; error: string }
  | { status: 'ok'; result: SuggestedLoanResult }

export async function calculateSuggestedLoanAction(
  _prev: CalculatorState,
  formData: FormData,
): Promise<CalculatorState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
    'appraiser',
  ])

  const countRaw = formData.get('row_count')
  const rowCount = Math.max(
    0,
    Math.min(20, parseInt(String(countRaw ?? '0'), 10) || 0),
  )

  const collateral: CollateralLoanInput[] = []
  for (let i = 0; i < rowCount; i++) {
    const metalRaw = String(formData.get(`row_${i}_metal`) ?? '').trim()
    const metal = (
      VALID_METALS.includes(metalRaw as MetalType) ? metalRaw : null
    ) as MetalType | null
    collateral.push({
      metal,
      karat: String(formData.get(`row_${i}_karat`) ?? '').trim() || null,
      weightGrams:
        String(formData.get(`row_${i}_weight_grams`) ?? '').trim() || null,
      estValue: String(formData.get(`row_${i}_est_value`) ?? '').trim() || null,
      appraisedValue:
        String(formData.get(`row_${i}_appraised_value`) ?? '').trim() || null,
    })
  }

  const ltvRaw = String(formData.get('ltv_percent') ?? '').trim()
  const ltvParsed = ltvRaw === '' ? null : parseFloat(ltvRaw)

  if (collateral.length === 0) {
    return { status: 'error', error: 'no_rows' }
  }

  try {
    const result = await computeSuggestedLoan({
      tenantId: ctx.tenantId,
      collateral,
      ltvPercent: ltvParsed,
    })
    return { status: 'ok', result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { status: 'error', error: msg }
  }
}
