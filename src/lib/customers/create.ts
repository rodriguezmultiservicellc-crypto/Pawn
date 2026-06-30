import 'server-only'

import { customerCreateSchema } from '@/lib/validations/customer'
import { logAudit } from '@/lib/audit'
import { applyReferredByCode } from '@/lib/loyalty/events'
import { createAdminClient } from '@/lib/supabase/admin'
import type { requireStaff } from '@/lib/supabase/guards'

/** Form keys we read off FormData for a customer create. Shared by the full
 *  create form and the inline quick-create modal so both stay in lockstep. */
export const CUSTOMER_FORM_FIELDS = [
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
  'dl_raw_payload',
  'referred_by_code',
] as const

type GuardedClient = Awaited<ReturnType<typeof requireStaff>>['supabase']

export type CreateCustomerCoreResult =
  | { ok: true; id: string; firstName: string; lastName: string }
  | {
      ok: false
      fieldErrors?: Record<string, string>
      error?: string
      echo: Record<string, string>
    }

/**
 * Validate + insert a customer from a FormData payload, then apply any
 * referral code and write the audit row. Does NOT redirect or revalidate —
 * callers decide what to do with the result (the full form redirects to the
 * customer detail; the inline modal returns the new id+label to the picker).
 *
 * Guard FIRST (caller runs requireStaff), then pass the user-scoped client +
 * userId here. RLS still enforces tenant isolation on the insert.
 */
export async function createCustomerFromForm(args: {
  supabase: GuardedClient
  tenantId: string
  userId: string
  formData: FormData
}): Promise<CreateCustomerCoreResult> {
  const { supabase, tenantId, userId, formData } = args

  const raw: Record<string, FormDataEntryValue | null> = {}
  const echo: Record<string, string> = {}
  for (const key of CUSTOMER_FORM_FIELDS) {
    const v = formData.get(key)
    raw[key] = v
    echo[key] = typeof v === 'string' ? v : ''
  }

  const parsed = customerCreateSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { ok: false, fieldErrors, echo }
  }

  const v = parsed.data

  const insertPayload = {
    tenant_id: tenantId,
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
    dl_raw_payload: v.dl_raw_payload,
    created_by: userId,
    updated_by: userId,
  }

  const { data, error } = await supabase
    .from('customers')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message, echo }
  if (!data?.id) return { ok: false, error: 'insert returned no id', echo }

  if (v.referred_by_code) {
    const admin = createAdminClient()
    await applyReferredByCode({
      admin,
      tenantId,
      newCustomerId: data.id,
      code: v.referred_by_code,
    })
  }

  await logAudit({
    tenantId,
    userId,
    action: 'create',
    tableName: 'customers',
    recordId: data.id,
    changes: {
      first_name: v.first_name,
      last_name: v.last_name,
      phone: v.phone,
      email: v.email,
      id_type: v.id_type,
      dl_scan_captured: v.dl_raw_payload != null,
    },
  })

  return { ok: true, id: data.id, firstName: v.first_name, lastName: v.last_name }
}
