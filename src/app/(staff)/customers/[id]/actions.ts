'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import {
  banCustomerSchema,
  customerCreateSchema,
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  customerDocumentUploadSchema,
} from '@/lib/validations/customer'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  customerDocumentPath,
  customerPhotoPath,
  deleteFromBucket,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'

export type UpdateCustomerState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
  /**
   * Echo of the most recent submission. Repopulates the form on
   * validation/insert error so React 19's auto-form-reset doesn't wipe
   * the operator's typed values. Only set when an error is returned.
   */
  values?: Record<string, string>
}

/**
 * Look up a customer's tenant via the user-scoped client (RLS gates the
 * read), then verify staff role at that tenant. Returns the resolved
 * tenantId or redirects.
 */
async function resolveCustomerTenant(customerId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: customer } = await ctx.supabase
    .from('customers')
    .select('tenant_id')
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) redirect('/customers')

  // requireStaff checks direct membership + chain-admin parent.
  const { supabase, userId } = await requireStaff(customer.tenant_id)
  return { tenantId: customer.tenant_id, supabase, userId }
}

export async function updateCustomerAction(
  _prev: UpdateCustomerState,
  formData: FormData,
): Promise<UpdateCustomerState> {
  const id = (formData.get('id') as string | null)?.trim()
  if (!id) return { error: 'missing id' }

  const { tenantId, supabase, userId } = await resolveCustomerTenant(id)

  const FIELDS = [
    'first_name',
    'last_name',
    'middle_name',
    'date_of_birth',
    'phone',
    'phone_alt',
    'email',
    'address1',
    'address2',
    'city',
    'state',
    'zip',
    'country',
    'id_type',
    'id_number',
    'id_state',
    'id_country',
    'id_expiry',
    'comm_preference',
    'language',
    'marketing_opt_in',
    'height_inches',
    'weight_lbs',
    'sex',
    'hair_color',
    'eye_color',
    'identifying_marks',
    'place_of_employment',
    'notes',
    'tags',
  ] as const

  const raw: Record<string, FormDataEntryValue | null> = {}
  const echo: Record<string, string> = {}
  for (const key of FIELDS) {
    const v = formData.get(key)
    raw[key] = v
    echo[key] = typeof v === 'string' ? v : ''
  }

  // Banned-list fields are NOT in the update schema — they're managed
  // exclusively by banCustomerAction below. The form doesn't render them,
  // so we use the create schema for the regular update path.
  const parsed = customerCreateSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors, values: echo }
  }

  const v = parsed.data

  const { error } = await supabase
    .from('customers')
    .update({
      first_name: v.first_name,
      last_name: v.last_name,
      middle_name: v.middle_name,
      date_of_birth: v.date_of_birth,
      phone: v.phone,
      phone_alt: v.phone_alt,
      email: v.email,
      address1: v.address1,
      address2: v.address2,
      city: v.city,
      state: v.state,
      zip: v.zip,
      country: v.country,
      id_type: v.id_type ?? null,
      id_number: v.id_number,
      id_state: v.id_state,
      id_country: v.id_country,
      id_expiry: v.id_expiry,
      comm_preference: v.comm_preference,
      language: v.language,
      marketing_opt_in: v.marketing_opt_in,
      height_inches: v.height_inches,
      weight_lbs: v.weight_lbs,
      sex: v.sex,
      hair_color: v.hair_color,
      eye_color: v.eye_color,
      identifying_marks: v.identifying_marks,
      place_of_employment: v.place_of_employment,
      notes: v.notes,
      tags: v.tags,
      updated_by: userId,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) return { error: error.message, values: echo }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'customers',
    recordId: id,
    changes: {
      first_name: v.first_name,
      last_name: v.last_name,
      phone: v.phone,
      email: v.email,
    },
  })

  revalidatePath(`/customers/${id}`)
  revalidatePath('/customers')
  return { ok: true }
}

export async function banCustomerAction(formData: FormData): Promise<void> {
  const raw = {
    customer_id: formData.get('customer_id'),
    is_banned: formData.get('is_banned') === 'on' ? true : false,
    reason: formData.get('reason'),
  }
  const parsed = banCustomerSchema.safeParse(raw)
  if (!parsed.success) return

  const { tenantId, supabase, userId } = await resolveCustomerTenant(
    parsed.data.customer_id,
  )

  await supabase
    .from('customers')
    .update({
      is_banned: parsed.data.is_banned,
      banned_reason: parsed.data.is_banned ? parsed.data.reason : null,
      banned_at: parsed.data.is_banned ? new Date().toISOString() : null,
      banned_by: parsed.data.is_banned ? userId : null,
      updated_by: userId,
    })
    .eq('id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: parsed.data.is_banned ? 'ban' : 'unban',
    tableName: 'customers',
    recordId: parsed.data.customer_id,
    changes: { reason: parsed.data.reason ?? null },
  })

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  revalidatePath('/customers')
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const id = (formData.get('id') as string | null)?.trim()
  if (!id) return

  const { tenantId, supabase, userId } = await resolveCustomerTenant(id)

  // Soft-delete only. Hard delete is gated on no active loans / sales /
  // repairs (those tables ship in later phases — gate is enforced at app
  // layer + DB FK as those land).
  await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'soft_delete',
    tableName: 'customers',
    recordId: id,
  })

  revalidatePath('/customers')
  redirect('/customers')
}

export async function uploadCustomerDocumentAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const raw = {
    customer_id: formData.get('customer_id'),
    kind: formData.get('kind'),
    id_type: formData.get('id_type'),
    id_number: formData.get('id_number'),
    id_state: formData.get('id_state'),
    id_expiry: formData.get('id_expiry'),
  }
  const parsed = customerDocumentUploadSchema.safeParse(raw)
  if (!parsed.success) return { error: 'validation_failed' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'no_file' }
  if (file.size > MAX_DOCUMENT_BYTES) return { error: 'too_large' }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as never)) {
    return { error: 'mime_not_allowed' }
  }

  const { tenantId, supabase, userId } = await resolveCustomerTenant(
    parsed.data.customer_id,
  )

  const path = customerDocumentPath({
    tenantId,
    customerId: parsed.data.customer_id,
    kind: parsed.data.kind,
    mimeType: file.type,
    filename: file.name,
  })

  await uploadToBucket({
    bucket: CUSTOMER_DOCUMENTS_BUCKET,
    path,
    body: file,
    contentType: file.type,
  })

  const { data: docRow, error } = await supabase
    .from('customer_documents')
    .insert({
      tenant_id: tenantId,
      customer_id: parsed.data.customer_id,
      kind: parsed.data.kind,
      storage_path: path,
      mime_type: file.type,
      byte_size: file.size,
      id_type: parsed.data.id_type ?? null,
      id_number: parsed.data.id_number,
      id_state: parsed.data.id_state,
      id_expiry: parsed.data.id_expiry,
      created_by: userId,
    })
    .select('id')
    .single()

  if (error) {
    // Best effort: try to clean up the uploaded file. If it fails, the
    // orphan is recoverable but the DB row is the harder inconsistency.
    await deleteFromBucket({ bucket: CUSTOMER_DOCUMENTS_BUCKET, path }).catch(
      () => {},
    )
    return { error: error.message }
  }

  if (docRow?.id) {
    await logAudit({
      tenantId,
      userId,
      action: 'doc_upload',
      tableName: 'customer_documents',
      recordId: docRow.id,
      changes: {
        customer_id: parsed.data.customer_id,
        kind: parsed.data.kind,
        mime_type: file.type,
      },
    })
  }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return {}
}

export async function uploadCustomerPhotoAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const customerId = (formData.get('customer_id') as string | null)?.trim()
  if (!customerId) return { error: 'missing customer_id' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'no_file' }
  if (file.size > MAX_DOCUMENT_BYTES) return { error: 'too_large' }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as never)) {
    return { error: 'mime_not_allowed' }
  }

  const { tenantId, supabase, userId } = await resolveCustomerTenant(customerId)

  // Read the prior photo path so we can clean it up after the swap.
  const { data: prior } = await supabase
    .from('customers')
    .select('photo_url')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const priorPath = prior?.photo_url ?? null

  const path = customerPhotoPath({
    tenantId,
    customerId,
    mimeType: file.type,
    filename: file.name,
  })

  await uploadToBucket({
    bucket: CUSTOMER_DOCUMENTS_BUCKET,
    path,
    body: file,
    contentType: file.type,
  })

  const { error } = await supabase
    .from('customers')
    .update({ photo_url: path, updated_by: userId })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)

  if (error) {
    await deleteFromBucket({ bucket: CUSTOMER_DOCUMENTS_BUCKET, path }).catch(
      () => {},
    )
    return { error: error.message }
  }

  // Best-effort cleanup of the prior photo file.
  if (priorPath && priorPath !== path) {
    await deleteFromBucket({
      bucket: CUSTOMER_DOCUMENTS_BUCKET,
      path: priorPath,
    }).catch(() => {})
  }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'customers',
    recordId: customerId,
    changes: { photo_swapped: true },
  })

  revalidatePath(`/customers/${customerId}`)
  return {}
}

export async function deleteCustomerDocumentAction(
  formData: FormData,
): Promise<void> {
  const documentId = (formData.get('document_id') as string | null)?.trim()
  const customerId = (formData.get('customer_id') as string | null)?.trim()
  if (!documentId || !customerId) return

  const { tenantId, supabase, userId } = await resolveCustomerTenant(customerId)

  // Read the row first so we know which storage path to remove. RLS
  // already gates this read to the tenant.
  const { data: doc } = await supabase
    .from('customer_documents')
    .select('storage_path, customer_id')
    .eq('id', documentId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!doc) return

  await supabase
    .from('customer_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('tenant_id', tenantId)

  await deleteFromBucket({
    bucket: CUSTOMER_DOCUMENTS_BUCKET,
    path: doc.storage_path,
  }).catch(() => {})

  // Touch the customer's updated_by so the audit trail picks up the change.
  await supabase
    .from('customers')
    .update({ updated_by: userId })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'doc_delete',
    tableName: 'customer_documents',
    recordId: documentId,
    changes: { customer_id: customerId },
  })

  revalidatePath(`/customers/${customerId}`)
}
