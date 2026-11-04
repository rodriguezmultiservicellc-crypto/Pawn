'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'

/**
 * The bench calculators' only writes: save / forget a recent calculation
 * for the signed-in user (patches/0066). Scratch paper, not a ledger —
 * no audit row, and the owner may hard-delete their own rows.
 */

export const CALCULATORS = [
  'ring_size',
  'weight',
  'alloy_down',
  'raise_karat',
  'mix_lots',
  'melt',
] as const
export type CalculatorKind = (typeof CALCULATORS)[number]

const saveSchema = z.object({
  calculator: z.enum(CALCULATORS),
  label: z.string().trim().min(1).max(200),
  inputs: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
})

export type SaveCalcResult = { ok: true; id: string } | { ok: false; error: string }

export async function saveCalculationAction(input: unknown): Promise<SaveCalcResult> {
  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) return { ok: false, error: 'not_signed_in' }
  const { supabase, userId } = await requireStaff(ctx.tenantId)

  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation_failed' }
  const v = parsed.data

  const { data, error } = await supabase
    .from('bench_calculations')
    .insert({
      tenant_id: ctx.tenantId,
      user_id: userId,
      calculator: v.calculator,
      label: v.label,
      inputs: v.inputs as never,
      result: v.result as never,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' }

  revalidatePath('/tools')
  return { ok: true, id: data.id }
}

export async function deleteCalculationAction(id: string): Promise<SaveCalcResult> {
  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) return { ok: false, error: 'not_signed_in' }
  const { supabase, userId } = await requireStaff(ctx.tenantId)
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'validation_failed' }

  // RLS already restricts to own rows; the explicit filters keep the
  // intent readable and defend if the policy ever loosens.
  const { error } = await supabase
    .from('bench_calculations')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/tools')
  return { ok: true, id }
}
