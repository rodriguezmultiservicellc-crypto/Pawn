'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  ALLOWED_APPRAISAL_PHOTO_MIME_TYPES,
  MAX_APPRAISAL_PHOTO_BYTES,
  appraisalCreateSchema,
} from '@/lib/validations/appraisal'
import {
  APPRAISAL_PHOTOS_BUCKET,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'
import type { TenantRole } from '@/types/database-aliases'

export type CreateAppraisalState = {
  error?: string
  fieldErrors?: Record<string, string>
}

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

/** Pull `stone_<n>_<field>` style entries out of FormData. */
function readStoneRows(fd: FormData) {
  const countRaw = fd.get('stone_count')
  const count = Math.max(
    0,
    Math.min(50, parseInt(String(countRaw ?? '0'), 10) || 0),
  )
  const rows: Array<Record<string, FormDataEntryValue | null>> = []
  for (let i = 0; i < count; i++) {
    rows.push({
      position: fd.get(`stone_${i}_position`) ?? String(i + 1),
      count: fd.get(`stone_${i}_count`),
      type: fd.get(`stone_${i}_type`),
      cut: fd.get(`stone_${i}_cut`),
      est_carat: fd.get(`stone_${i}_est_carat`),
      color: fd.get(`stone_${i}_color`),
      clarity: fd.get(`stone_${i}_clarity`),
      certified: fd.get(`stone_${i}_certified`) ?? 'false',
      cert_lab: fd.get(`stone_${i}_cert_lab`),
      cert_number: fd.get(`stone_${i}_cert_number`),
      notes: fd.get(`stone_${i}_notes`),
    })
  }
  return rows.filter(
    (r) =>
      (typeof r.type === 'string' && r.type.trim().length > 0) ||
      (typeof r.cut === 'string' && r.cut.trim().length > 0) ||
      (typeof r.est_carat === 'string' && r.est_carat.trim().length > 0),
  )
}

export async function createAppraisalAction(
  _prev: CreateAppraisalState,
  formData: FormData,
): Promise<CreateAppraisalState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    STAFF_APPRAISAL_ROLES,
  )
  const tenantId = ctx.tenantId

  const stoneRows = readStoneRows(formData)

  const parsed = appraisalCreateSchema.safeParse({
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
    stones: stoneRows,
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors, error: 'validation_failed' }
  }

  const v = parsed.data

  // Defense-in-depth: confirm customer (if provided) is in this tenant.
  if (v.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('id', v.customer_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!customer) return { error: 'not_found' }
  }
  if (v.inventory_item_id) {
    const { data: inv } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('id', v.inventory_item_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!inv) return { error: 'not_found' }
  }

  // 1. Insert the appraisal. Trigger assigns appraisal_number.
  const { data: appraisal, error: aErr } = await supabase
    .from('appraisals')
    .insert({
      tenant_id: tenantId,
      customer_id: v.customer_id,
      inventory_item_id: v.inventory_item_id,
      item_description: v.item_description,
      metal_type: v.metal_type,
      karat: v.karat,
      weight_grams: v.weight_grams,
      purpose: v.purpose,
      appraised_value: v.appraised_value,
      replacement_value: v.replacement_value,
      valuation_method: v.valuation_method,
      notes: v.notes,
      valid_from: v.valid_from,
      valid_until: v.valid_until,
      appraiser_user_id: userId,
      status: 'draft',
      created_by: userId,
      updated_by: userId,
    })
    .select('id, appraisal_number')
    .single()
  if (aErr || !appraisal) return { error: aErr?.message ?? 'insert_failed' }
  const appraisalId = appraisal.id

  // 2. Insert stones.
  if (v.stones && v.stones.length > 0) {
    const rows = v.stones.map((s, idx) => ({
      appraisal_id: appraisalId,
      tenant_id: tenantId,
      position: s.position ?? idx + 1,
      count: s.count,
      type: s.type,
      cut: s.cut,
      est_carat: s.est_carat,
      color: s.color,
      clarity: s.clarity,
      certified: s.certified,
      cert_lab: s.cert_lab,
      cert_number: s.cert_number,
      notes: s.notes,
    }))
    await supabase.from('appraisal_stones').insert(rows)
  }

  // 3. Upload photos (multiple under 'photo_files'). First photo becomes
  //    the primary 'front' shot if no kind hint is given.
  const photoFiles = formData
    .getAll('photo_files')
    .filter((f): f is File => f instanceof File && f.size > 0)
  let photoCount = 0
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i]
    if (f.size > MAX_APPRAISAL_PHOTO_BYTES) continue
    if (!ALLOWED_APPRAISAL_PHOTO_MIME_TYPES.includes(f.type as never)) continue
    const ext = pickExt(f.type, f.name)
    const kind = i === 0 ? 'front' : 'detail'
    const path = `${tenantId}/${appraisalId}/${kind}/${newUuid()}.${ext}`
    try {
      await uploadToBucket({
        bucket: APPRAISAL_PHOTOS_BUCKET,
        path,
        body: f,
        contentType: f.type,
      })
      await supabase.from('appraisal_photos').insert({
        appraisal_id: appraisalId,
        tenant_id: tenantId,
        storage_path: path,
        kind,
        position: i,
        created_by: userId,
      })
      photoCount++
    } catch (err) {
      console.error('[appraisal.create] photo upload failed', err)
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'appraisal_create',
    tableName: 'appraisals',
    recordId: appraisalId,
    changes: {
      appraisal_number: appraisal.appraisal_number,
      purpose: v.purpose,
      customer_id: v.customer_id,
      inventory_item_id: v.inventory_item_id,
      appraised_value: v.appraised_value,
      stones_count: v.stones?.length ?? 0,
      photos_count: photoCount,
    },
  })

  revalidatePath('/appraisals')
  redirect(`/appraisals/${appraisalId}`)
}
