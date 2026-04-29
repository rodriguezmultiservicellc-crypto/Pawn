'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  ALLOWED_APPRAISAL_PHOTO_MIME_TYPES,
  MAX_APPRAISAL_PHOTO_BYTES,
  appraisalAddPhotoSchema,
  appraisalFinalizeSchema,
  appraisalStoneUpsertSchema,
  appraisalUpdateSchema,
  appraisalVoidSchema,
} from '@/lib/validations/appraisal'
import {
  APPRAISAL_PHOTOS_BUCKET,
  deleteFromBucket,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'
import { canTransition, checkFinalizeReadiness } from '@/lib/appraisals/workflow'
import type {
  AppraisalStatus,
  AppraisalUpdate,
  TenantRole,
} from '@/types/database-aliases'

export type ActionResult = { error?: string; ok?: boolean }

const STAFF_APPRAISAL_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
  'chain_admin',
]

function pickExt(mime: string | null | undefined, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  return 'bin'
}

function newUuid(): string {
  return crypto.randomUUID()
}

async function resolveAppraisalScope(appraisalId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: appraisal } = await ctx.supabase
    .from('appraisals')
    .select(
      'id, tenant_id, status, is_printed, appraised_value, appraiser_user_id, valid_from, appraisal_number',
    )
    .eq('id', appraisalId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!appraisal) redirect('/appraisals')
  const { supabase, userId } = await requireRoleInTenant(
    appraisal.tenant_id,
    STAFF_APPRAISAL_ROLES,
  )
  return {
    appraisal,
    supabase,
    userId,
    tenantId: appraisal.tenant_id,
  }
}

// ── Update basic fields (draft-only) ────────────────────────────────────────

export async function updateAppraisalAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = appraisalUpdateSchema.safeParse({
    appraisal_id: formData.get('appraisal_id'),
    customer_id: formData.get('customer_id'),
    inventory_item_id: formData.get('inventory_item_id'),
    item_description: formData.get('item_description'),
    metal_type: formData.get('metal_type'),
    karat: formData.get('karat'),
    weight_grams: formData.get('weight_grams'),
    purpose: formData.get('purpose'),
    appraised_value: formData.get('appraised_value'),
    replacement_value: formData.get('replacement_value'),
    valuation_method: formData.get('valuation_method'),
    notes: formData.get('notes'),
    valid_from: formData.get('valid_from'),
    valid_until: formData.get('valid_until'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { appraisal, supabase, userId, tenantId } = await resolveAppraisalScope(
    v.appraisal_id,
  )
  if (appraisal.status !== 'draft') return { error: 'illegal_status' }
  if (appraisal.is_printed) return { error: 'locked' }

  const patch: AppraisalUpdate = { updated_by: userId }
  if (v.customer_id !== undefined) patch.customer_id = v.customer_id
  if (v.inventory_item_id !== undefined)
    patch.inventory_item_id = v.inventory_item_id
  if (v.item_description !== undefined)
    patch.item_description = v.item_description
  if (v.metal_type !== undefined) patch.metal_type = v.metal_type
  if (v.karat !== undefined) patch.karat = v.karat
  if (v.weight_grams !== undefined) patch.weight_grams = v.weight_grams
  if (v.purpose !== undefined) patch.purpose = v.purpose
  if (v.appraised_value !== undefined && v.appraised_value !== null)
    patch.appraised_value = v.appraised_value
  if (v.replacement_value !== undefined)
    patch.replacement_value = v.replacement_value
  if (v.valuation_method !== undefined)
    patch.valuation_method = v.valuation_method
  if (v.notes !== undefined) patch.notes = v.notes
  if (v.valid_from !== undefined && v.valid_from !== null)
    patch.valid_from = v.valid_from
  if (v.valid_until !== undefined) patch.valid_until = v.valid_until

  const { error } = await supabase
    .from('appraisals')
    .update(patch)
    .eq('id', appraisal.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'appraisal_update',
    tableName: 'appraisals',
    recordId: appraisal.id,
    changes: patch as Record<string, unknown>,
  })

  revalidatePath(`/appraisals/${appraisal.id}`)
  revalidatePath('/appraisals')
  return { ok: true }
}

// ── Finalize ───────────────────────────────────────────────────────────────

export async function finalizeAppraisalAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = appraisalFinalizeSchema.safeParse({
    appraisal_id: formData.get('appraisal_id'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { appraisal, supabase, userId, tenantId } = await resolveAppraisalScope(
    v.appraisal_id,
  )
  if (!canTransition(appraisal.status as AppraisalStatus, 'finalized'))
    return { error: 'illegal_status' }

  const readiness = checkFinalizeReadiness({
    appraised_value:
      appraisal.appraised_value == null
        ? null
        : Number(appraisal.appraised_value),
    appraiser_user_id: appraisal.appraiser_user_id,
    valid_from: appraisal.valid_from,
    status: appraisal.status as AppraisalStatus,
  })
  if (!readiness.ok) return { error: readiness.reason }

  const { error } = await supabase
    .from('appraisals')
    .update({
      status: 'finalized',
      finalized_at: new Date().toISOString(),
      finalized_by: userId,
      updated_by: userId,
    })
    .eq('id', appraisal.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'appraisal_finalize',
    tableName: 'appraisals',
    recordId: appraisal.id,
    changes: {
      appraisal_number: appraisal.appraisal_number,
      new_status: 'finalized',
    },
  })

  revalidatePath(`/appraisals/${appraisal.id}`)
  revalidatePath('/appraisals')
  return { ok: true }
}

// ── Void ───────────────────────────────────────────────────────────────────

export async function voidAppraisalAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = appraisalVoidSchema.safeParse({
    appraisal_id: formData.get('appraisal_id'),
    void_reason: formData.get('void_reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { appraisal, supabase, userId, tenantId } = await resolveAppraisalScope(
    v.appraisal_id,
  )
  if (!canTransition(appraisal.status as AppraisalStatus, 'voided'))
    return { error: 'illegal_status' }

  const { error } = await supabase
    .from('appraisals')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: userId,
      void_reason: v.void_reason,
      updated_by: userId,
    })
    .eq('id', appraisal.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'appraisal_void',
    tableName: 'appraisals',
    recordId: appraisal.id,
    changes: {
      appraisal_number: appraisal.appraisal_number,
      reason: v.void_reason,
      new_status: 'voided',
    },
  })

  revalidatePath(`/appraisals/${appraisal.id}`)
  revalidatePath('/appraisals')
  return { ok: true }
}

// ── Stones (upsert / delete) ────────────────────────────────────────────────

export async function upsertStoneAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = appraisalStoneUpsertSchema.safeParse({
    appraisal_id: formData.get('appraisal_id'),
    stone_id: formData.get('stone_id'),
    position: formData.get('position'),
    count: formData.get('count'),
    type: formData.get('type'),
    cut: formData.get('cut'),
    est_carat: formData.get('est_carat'),
    color: formData.get('color'),
    clarity: formData.get('clarity'),
    certified: formData.get('certified') ?? 'false',
    cert_lab: formData.get('cert_lab'),
    cert_number: formData.get('cert_number'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { appraisal, supabase, userId, tenantId } = await resolveAppraisalScope(
    v.appraisal_id,
  )
  if (appraisal.is_printed) return { error: 'locked' }

  const row = {
    appraisal_id: appraisal.id,
    tenant_id: tenantId,
    position: v.position,
    count: v.count,
    type: v.type,
    cut: v.cut,
    est_carat: v.est_carat,
    color: v.color,
    clarity: v.clarity,
    certified: v.certified,
    cert_lab: v.cert_lab,
    cert_number: v.cert_number,
    notes: v.notes,
  }

  let recordId: string | null = null
  if (v.stone_id) {
    const { data: updated, error } = await supabase
      .from('appraisal_stones')
      .update(row)
      .eq('id', v.stone_id)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle()
    if (error) return { error: error.message }
    recordId = updated?.id ?? v.stone_id
  } else {
    const { data: inserted, error } = await supabase
      .from('appraisal_stones')
      .insert(row)
      .select('id')
      .single()
    if (error) return { error: error.message }
    recordId = inserted.id
  }

  await logAudit({
    tenantId,
    userId,
    action: 'appraisal_stone_upsert',
    tableName: 'appraisal_stones',
    recordId: recordId ?? appraisal.id,
    changes: {
      appraisal_id: appraisal.id,
      position: v.position,
      type: v.type,
      certified: v.certified,
    },
  })

  revalidatePath(`/appraisals/${appraisal.id}`)
  return { ok: true }
}

export async function removeStoneAction(
  stoneId: string,
): Promise<ActionResult> {
  if (!stoneId) return { error: 'validation_failed' }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: stone } = await ctx.supabase
    .from('appraisal_stones')
    .select('id, tenant_id, appraisal_id')
    .eq('id', stoneId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!stone) return { error: 'not_found' }
  const { supabase, userId } = await requireRoleInTenant(
    stone.tenant_id,
    STAFF_APPRAISAL_ROLES,
  )

  // Block if parent is locked.
  const { data: parent } = await supabase
    .from('appraisals')
    .select('is_printed, status')
    .eq('id', stone.appraisal_id)
    .maybeSingle()
  if (parent?.is_printed) return { error: 'locked' }

  const { error } = await supabase
    .from('appraisal_stones')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', stoneId)
    .eq('tenant_id', stone.tenant_id)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: stone.tenant_id,
    userId,
    action: 'appraisal_stone_delete',
    tableName: 'appraisal_stones',
    recordId: stoneId,
    changes: { appraisal_id: stone.appraisal_id },
  })

  revalidatePath(`/appraisals/${stone.appraisal_id}`)
  return { ok: true }
}

// ── Photos ─────────────────────────────────────────────────────────────────

export async function addPhotoAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = appraisalAddPhotoSchema.safeParse({
    appraisal_id: formData.get('appraisal_id'),
    kind: formData.get('kind'),
    caption: formData.get('caption'),
    position: formData.get('position'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { appraisal, supabase, userId, tenantId } = await resolveAppraisalScope(
    v.appraisal_id,
  )

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0)
    return { error: 'validation_failed' }
  if (file.size > MAX_APPRAISAL_PHOTO_BYTES) return { error: 'tooLarge' }
  if (!ALLOWED_APPRAISAL_PHOTO_MIME_TYPES.includes(file.type as never))
    return { error: 'mimeNotAllowed' }

  const ext = pickExt(file.type, file.name)
  const path = `${tenantId}/${appraisal.id}/${v.kind}/${newUuid()}.${ext}`
  try {
    await uploadToBucket({
      bucket: APPRAISAL_PHOTOS_BUCKET,
      path,
      body: file,
      contentType: file.type,
    })
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'uploadFailed',
    }
  }

  const { data: inserted, error } = await supabase
    .from('appraisal_photos')
    .insert({
      appraisal_id: appraisal.id,
      tenant_id: tenantId,
      storage_path: path,
      kind: v.kind,
      caption: v.caption,
      position: v.position,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'appraisal_photo_upload',
    tableName: 'appraisal_photos',
    recordId: inserted?.id ?? appraisal.id,
    changes: { appraisal_id: appraisal.id, kind: v.kind },
  })

  revalidatePath(`/appraisals/${appraisal.id}`)
  return { ok: true }
}

export async function removePhotoAction(
  photoId: string,
): Promise<ActionResult> {
  if (!photoId) return { error: 'validation_failed' }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: photo } = await ctx.supabase
    .from('appraisal_photos')
    .select('id, tenant_id, appraisal_id, storage_path')
    .eq('id', photoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!photo) return { error: 'not_found' }
  const { supabase, userId } = await requireRoleInTenant(
    photo.tenant_id,
    STAFF_APPRAISAL_ROLES,
  )

  const { error } = await supabase
    .from('appraisal_photos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', photoId)
    .eq('tenant_id', photo.tenant_id)
  if (error) return { error: error.message }

  await deleteFromBucket({
    bucket: APPRAISAL_PHOTOS_BUCKET,
    path: photo.storage_path,
  })

  await logAudit({
    tenantId: photo.tenant_id,
    userId,
    action: 'appraisal_photo_delete',
    tableName: 'appraisal_photos',
    recordId: photoId,
    changes: { appraisal_id: photo.appraisal_id },
  })

  revalidatePath(`/appraisals/${photo.appraisal_id}`)
  return { ok: true }
}
