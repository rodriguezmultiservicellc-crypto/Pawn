'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { customerCreateSchema } from '@/lib/validations/customer'
import { logAudit } from '@/lib/audit'

export type CreateCustomerState = {
  error?: string
  fieldErrors?: Record<string, string>
}

const initial: CreateCustomerState = {}

export async function createCustomerAction(
  _prev: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Defense in depth: re-verify staff role at the active tenant. requireStaff
  // also handles chain-admin parent-tenant access.
  const { supabase, userId } = await requireStaff(ctx.tenantId)

  // Convert FormData to a plain object for Zod. Tags arrive as a single
  // comma-separated hidden input — the schema preprocessor handles that.
  const raw: Record<string, FormDataEntryValue | null> = {}
  for (const key of [
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
  ]) {
    raw[key] = formData.get(key)
  }

  const parsed = customerCreateSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }

  const v = parsed.data

  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: ctx.tenantId,
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
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  if (!data?.id) return { error: 'insert returned no id' }

  await logAudit({
    tenantId: ctx.tenantId,
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
    },
  })

  revalidatePath('/customers')
  redirect(`/customers/${data.id}`)
}

export { initial as createCustomerInitialState }
