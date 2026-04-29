'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  collateralItemSchema,
  loanCreateSchema,
  ALLOWED_LOAN_PHOTO_MIME_TYPES,
  ALLOWED_SIGNATURE_MIME_TYPES,
  MAX_LOAN_PHOTO_BYTES,
  MAX_SIGNATURE_BYTES,
  type CollateralItemInput,
} from '@/lib/validations/loan'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  INVENTORY_PHOTOS_BUCKET,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'
import { checkPlanLimit, countActiveLoans } from '@/lib/saas/gates'
import {
  computeSuggestedLoan,
  type CollateralLoanInput,
  type SuggestedLoanResult,
} from '@/lib/pawn/suggested-loan'
import type { Database } from '@/types/database'
import type { MetalType } from '@/types/database-aliases'

export type CreateLoanState = {
  error?: string
  fieldErrors?: Record<string, string>
}

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

export type SuggestLoanState =
  | { status: 'idle' }
  | { status: 'error'; error: string }
  | { status: 'ok'; result: SuggestedLoanResult }

/**
 * Inline calculator action — reads the SAME collateral_<n>_* field
 * names that the pawn-new form's CollateralItemsList writes, so the
 * operator can hit "Calculate" inline and get a suggested principal
 * without leaving the page.
 *
 * Distinct from calculateSuggestedLoanAction in /pawn/calculator —
 * that action reads row_<n>_* (its own field names). Both call the
 * same lib/pawn/suggested-loan.computeSuggestedLoan under the hood.
 */
export async function suggestLoanFromCollateralAction(
  _prev: SuggestLoanState,
  formData: FormData,
): Promise<SuggestLoanState> {
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

  const countRaw = formData.get('collateral_count')
  const count = Math.max(
    0,
    Math.min(50, parseInt(String(countRaw ?? '0'), 10) || 0),
  )

  const collateral: CollateralLoanInput[] = []
  for (let i = 0; i < count; i++) {
    const metalRaw = String(formData.get(`collateral_${i}_metal_type`) ?? '')
      .trim()
    const metal = (
      VALID_METALS.includes(metalRaw as MetalType) ? metalRaw : null
    ) as MetalType | null
    collateral.push({
      metal,
      karat: String(formData.get(`collateral_${i}_karat`) ?? '').trim() || null,
      weightGrams:
        String(formData.get(`collateral_${i}_weight_grams`) ?? '').trim() ||
        null,
      estValue:
        String(formData.get(`collateral_${i}_est_value`) ?? '').trim() || null,
      appraisedValue: null, // pawn-new flow doesn't expose this; appraisal
                            // links happen later from the /pawn/<id> page.
    })
  }

  if (collateral.length === 0) {
    return { status: 'error', error: 'no_rows' }
  }

  const ltvRaw = String(formData.get('ltv_percent') ?? '').trim()
  const ltvParsed = ltvRaw === '' ? null : parseFloat(ltvRaw)

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


type ComplianceInsertChanges =
  Database['public']['Tables']['compliance_log']['Insert']['customer_snapshot']

function pickExt(mime: string | null | undefined, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (mime) {
    if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
    if (mime === 'image/png') return 'png'
    if (mime === 'image/webp') return 'webp'
    if (mime === 'image/heic') return 'heic'
    if (mime === 'application/pdf') return 'pdf'
  }
  return 'bin'
}

function newUuid(): string {
  return crypto.randomUUID()
}

/**
 * Parse `collateral_<n>_<field>` entries out of FormData into an array of
 * CollateralItemInput. Files (`collateral_<n>_photo`) are pulled separately
 * by the action so it can upload first and then write the validated path.
 */
function readCollateralRows(
  fd: FormData,
): Array<{ raw: Record<string, FormDataEntryValue | null>; photo: File | null }> {
  const countRaw = fd.get('collateral_count')
  const count = Math.max(0, Math.min(50, parseInt(String(countRaw ?? '0'), 10) || 0))
  const rows: Array<{
    raw: Record<string, FormDataEntryValue | null>
    photo: File | null
  }> = []
  for (let i = 0; i < count; i++) {
    const photoVal = fd.get(`collateral_${i}_photo`)
    const photo =
      photoVal instanceof File && photoVal.size > 0 ? photoVal : null
    rows.push({
      raw: {
        description: fd.get(`collateral_${i}_description`),
        category: fd.get(`collateral_${i}_category`),
        metal_type: fd.get(`collateral_${i}_metal_type`),
        karat: fd.get(`collateral_${i}_karat`),
        weight_grams: fd.get(`collateral_${i}_weight_grams`),
        est_value: fd.get(`collateral_${i}_est_value`),
        position: String(i),
      },
      photo,
    })
  }
  return rows
}

export async function createLoanAction(
  _prev: CreateLoanState,
  formData: FormData,
): Promise<CreateLoanState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module + role gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const tenantId = ctx.tenantId

  // Plan-tier gate: enforce max_active_loans BEFORE validation so the
  // operator sees an upgrade prompt instead of a generic field error.
  const activeLoanCount = await countActiveLoans(tenantId)
  const limitCheck = await checkPlanLimit(
    tenantId,
    'max_active_loans',
    activeLoanCount,
  )
  if (!limitCheck.allowed) {
    return {
      error: `plan_limit_reached:max_active_loans:${limitCheck.current}/${limitCheck.limit ?? 0}:${limitCheck.planCode ?? '—'}`,
    }
  }

  // Auto-compute due_date if not provided.
  const issueDateRaw = String(formData.get('issue_date') ?? '').trim()
  const issueDate =
    /^\d{4}-\d{2}-\d{2}$/.test(issueDateRaw) ? issueDateRaw : todayDateString()
  const termDaysRaw = String(formData.get('term_days') ?? '').trim()
  const termDays = parseInt(termDaysRaw || '0', 10) || 0
  const dueDateRaw = String(formData.get('due_date') ?? '').trim()
  const computedDueDate =
    /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)
      ? dueDateRaw
      : termDays > 0
      ? addDaysIso(issueDate, termDays)
      : null

  const collateralRaw = readCollateralRows(formData)

  const parsed = loanCreateSchema.safeParse({
    customer_id: formData.get('customer_id'),
    principal: formData.get('principal'),
    interest_rate_monthly: formData.get('interest_rate_monthly'),
    term_days: termDays,
    issue_date: issueDate,
    due_date: computedDueDate,
    signature_path: null,
    notes: formData.get('notes'),
    collateral: collateralRaw.map((r) => ({
      ...r.raw,
      // Photo path filled in below after upload.
      photo_path: null,
    })),
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

  // Defense in depth: re-validate the customer belongs to this tenant.
  const { data: customer } = await supabase
    .from('customers')
    .select(
      'id, first_name, last_name, middle_name, date_of_birth, phone, email, address1, address2, city, state, zip, country, id_type, id_number, id_state, id_expiry, height_inches, weight_lbs, sex, hair_color, eye_color, identifying_marks, place_of_employment, photo_url',
    )
    .eq('id', v.customer_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) return { error: 'customer_not_found' }

  // Phase 1 of intake: insert the loan first to obtain the id (for storage paths).
  // Trigger assigns ticket_number.
  const { data: loanRow, error: loanErr } = await supabase
    .from('loans')
    .insert({
      tenant_id: tenantId,
      customer_id: v.customer_id,
      principal: v.principal,
      interest_rate_monthly: v.interest_rate_monthly,
      term_days: v.term_days,
      issue_date: v.issue_date,
      due_date: v.due_date ?? addDaysIso(v.issue_date, v.term_days),
      status: 'active',
      is_printed: false,
      notes: v.notes,
      created_by: userId,
      updated_by: userId,
    })
    .select('id, ticket_number')
    .single()

  if (loanErr || !loanRow) {
    return { error: loanErr?.message ?? 'insert_failed' }
  }

  const loanId = loanRow.id

  // Upload signature, if provided. Bucket: customer-documents (same RLS as
  // ID scans). Path: <tenantId>/<customerId>/loans/<loanId>/signature_<uuid>.<ext>
  const sigFile = formData.get('signature_file')
  let signaturePath: string | null = null
  if (sigFile instanceof File && sigFile.size > 0) {
    if (sigFile.size > MAX_SIGNATURE_BYTES) {
      return { error: 'signature_too_large' }
    }
    if (!ALLOWED_SIGNATURE_MIME_TYPES.includes(sigFile.type as never)) {
      return { error: 'signature_mime_not_allowed' }
    }
    const ext = pickExt(sigFile.type, sigFile.name)
    const path = `${tenantId}/${v.customer_id}/loans/${loanId}/signature_${newUuid()}.${ext}`
    try {
      await uploadToBucket({
        bucket: CUSTOMER_DOCUMENTS_BUCKET,
        path,
        body: sigFile,
        contentType: sigFile.type,
      })
      signaturePath = path
    } catch (err) {
      // Non-fatal — let the loan exist without a signature for now; clerk can
      // upload after. Surface to the user though.
      console.error('[pawn.create] signature upload failed', err)
    }
  }

  // Upload each collateral photo, then insert the snapshot rows.
  const collateralInserts: Array<CollateralItemInput & { photo_path: string | null }> = []
  for (let i = 0; i < v.collateral.length; i++) {
    const item = v.collateral[i]
    const file = collateralRaw[i]?.photo ?? null
    let photoPath: string | null = null
    if (file && file.size > 0) {
      if (file.size > MAX_LOAN_PHOTO_BYTES) {
        return { error: 'photo_too_large' }
      }
      if (!ALLOWED_LOAN_PHOTO_MIME_TYPES.includes(file.type as never)) {
        return { error: 'photo_mime_not_allowed' }
      }
      const ext = pickExt(file.type, file.name)
      const path = `${tenantId}/loans/${loanId}/${newUuid()}.${ext}`
      try {
        await uploadToBucket({
          bucket: INVENTORY_PHOTOS_BUCKET,
          path,
          body: file,
          contentType: file.type,
        })
        photoPath = path
      } catch (err) {
        console.error('[pawn.create] collateral photo upload failed', err)
      }
    }
    // Validate the row again with photo_path (paranoia + uniform shape).
    const rowParsed = collateralItemSchema.safeParse({
      ...item,
      photo_path: photoPath,
    })
    if (!rowParsed.success) continue
    collateralInserts.push({ ...rowParsed.data, position: i })
  }

  if (collateralInserts.length === 0) {
    return { error: 'no_valid_collateral' }
  }

  const { error: collErr } = await supabase.from('loan_collateral_items').insert(
    collateralInserts.map((it) => ({
      loan_id: loanId,
      tenant_id: tenantId,
      description: it.description,
      category: it.category,
      metal_type: it.metal_type ?? null,
      karat: it.karat,
      weight_grams: it.weight_grams,
      est_value: it.est_value,
      photo_path: it.photo_path,
      position: it.position,
    })),
  )
  if (collErr) {
    return { error: collErr.message }
  }

  // Update the loan with signature_path if we got one.
  if (signaturePath) {
    await supabase
      .from('loans')
      .update({ signature_path: signaturePath })
      .eq('id', loanId)
      .eq('tenant_id', tenantId)
  }

  // Issue event.
  await supabase.from('loan_events').insert({
    loan_id: loanId,
    tenant_id: tenantId,
    event_type: 'issued',
    amount: v.principal,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    payment_method: null,
    notes: null,
    performed_by: userId,
  })

  // Compliance log — write-once intake snapshot. The 0001 schema models this
  // as event_type='pawn_intake' + source_table='loans' + source_id. Snapshots
  // are JSONB so the police-report exporter has a deterministic source.
  const customerSnapshot = {
    id: customer.id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    middle_name: customer.middle_name,
    date_of_birth: customer.date_of_birth,
    phone: customer.phone,
    email: customer.email,
    address1: customer.address1,
    address2: customer.address2,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    country: customer.country,
    id_type: customer.id_type,
    id_number: customer.id_number,
    id_state: customer.id_state,
    id_expiry: customer.id_expiry,
    // FL pawn-statute physical description fields (Phase 1 / 0004).
    height_inches: customer.height_inches,
    weight_lbs: customer.weight_lbs,
    sex: customer.sex,
    hair_color: customer.hair_color,
    eye_color: customer.eye_color,
    identifying_marks: customer.identifying_marks,
    place_of_employment: customer.place_of_employment,
    photo_url: customer.photo_url,
  } as unknown as ComplianceInsertChanges

  const itemsSnapshot = collateralInserts.map((it) => ({
    description: it.description,
    category: it.category,
    metal_type: it.metal_type,
    karat: it.karat,
    weight_grams: it.weight_grams,
    est_value: it.est_value,
    photo_path: it.photo_path,
    position: it.position,
  })) as unknown as ComplianceInsertChanges

  await supabase.from('compliance_log').insert({
    tenant_id: tenantId,
    source_table: 'loans',
    source_id: loanId,
    event_type: 'pawn_intake',
    customer_snapshot: customerSnapshot,
    items_snapshot: itemsSnapshot,
    amount: v.principal,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'create',
    tableName: 'loans',
    recordId: loanId,
    changes: {
      ticket_number: loanRow.ticket_number,
      principal: v.principal,
      interest_rate_monthly: v.interest_rate_monthly,
      term_days: v.term_days,
      customer_id: v.customer_id,
      collateral_count: collateralInserts.length,
    },
  })

  revalidatePath('/pawn')
  redirect(`/pawn/${loanId}`)
}
