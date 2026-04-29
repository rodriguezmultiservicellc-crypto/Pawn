'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'

const watchSchema = z.object({
  brand: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
  reference_no: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(60).nullable().optional(),
    )
    .transform((v) => v ?? null),
  nickname: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(80).nullable().optional(),
    )
    .transform((v) => v ?? null),
  year_start: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    )
    .transform((v) => v ?? null),
  year_end: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    )
    .transform((v) => v ?? null),
  est_value_min: z.coerce.number().min(0).max(10_000_000),
  est_value_max: z.coerce.number().min(0).max(10_000_000),
  notes: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(2000).nullable().optional(),
    )
    .transform((v) => v ?? null),
}).refine((v) => v.est_value_max >= v.est_value_min, {
  message: 'max_below_min',
  path: ['est_value_max'],
})

export type WatchModelState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

export async function saveWatchModelAction(
  _prev: WatchModelState,
  formData: FormData,
): Promise<WatchModelState> {
  const { userId } = await requireSuperAdmin()

  const id = String(formData.get('id') ?? '').trim()

  const parsed = watchSchema.safeParse({
    brand: formData.get('brand'),
    model: formData.get('model'),
    reference_no: formData.get('reference_no'),
    nickname: formData.get('nickname'),
    year_start: formData.get('year_start'),
    year_end: formData.get('year_end'),
    est_value_min: formData.get('est_value_min'),
    est_value_max: formData.get('est_value_max'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()
  if (id) {
    const { error } = await admin
      .from('watch_models')
      .update({
        brand: v.brand,
        model: v.model,
        reference_no: v.reference_no,
        nickname: v.nickname,
        year_start: v.year_start,
        year_end: v.year_end,
        est_value_min: v.est_value_min,
        est_value_max: v.est_value_max,
        notes: v.notes,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('watch_models').insert({
      brand: v.brand,
      model: v.model,
      reference_no: v.reference_no,
      nickname: v.nickname,
      year_start: v.year_start,
      year_end: v.year_end,
      est_value_min: v.est_value_min,
      est_value_max: v.est_value_max,
      notes: v.notes,
      created_by: userId,
      updated_by: userId,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/admin/watch-models')
  return { ok: true }
}

export async function deleteWatchModelAction(
  _prev: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const { userId } = await requireSuperAdmin()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'invalid' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('watch_models')
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/watch-models')
  return { ok: true }
}
