'use server'

/**
 * Business profile + government-form answers (patches/0110). Owner only:
 * requireOwner first, then the caller's own client — RLS
 * (tenant_business_profile_owner) is the second lock.
 */

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { ADDRESS_TYPES, ENTITY_TYPES, normalizeOfficers } from '@/lib/agency-forms/profile'
import { loadBusinessProfile } from '@/lib/agency-forms/load'
import { agencyForm } from '@/lib/agency-forms'
import { answersFor } from '@/lib/agency-forms/types'
import { stateCode } from '@/lib/agency-forms/us-states'
import type { Json } from '@/types/database'

const text = z
  .preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null), z.string().max(300).nullable())

const state = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? (stateCode(v) ?? 'invalid') : null),
  z.string().regex(/^[A-Z]{2}$/, 'state').nullable(),
)

const digits = (n: number, code: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.replace(/\D/g, '') : null),
    z.string().regex(new RegExp(`^\\d{${n}}$`), code).nullable(),
  )

const addressType = z.preprocess((v) => (v === '' ? null : v), z.enum(ADDRESS_TYPES).nullable())

const profileSchema = z.object({
  legal_name: text,
  ein: digits(9, 'ein').transform((v) => (v ? `${v.slice(0, 2)}-${v.slice(2)}` : null)),
  entity_type: z.preprocess((v) => (v === '' ? null : v), z.enum(ENTITY_TYPES).nullable()),
  incorporation_state: state,
  incorporation_number: text,
  year_established: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : null),
    z.number({ message: 'year' }).int('year').min(1800, 'year').max(2100, 'year').nullable(),
  ),
  naics_code: digits(6, 'naics'),
  business_description: text,
  duns: text,
  phone: text,
  phone_ext: text,
  fax: text,
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
    z.string().email('email').nullable(),
  ),
  website: text,
  mailing_address1: text,
  mailing_address2: text,
  mailing_city: text,
  mailing_state: state,
  mailing_zip: text,
  mailing_type: addressType,
  physical_same: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  physical_address1: text,
  physical_address2: text,
  physical_city: text,
  physical_state: state,
  physical_zip: text,
  physical_type: addressType,
  bank_name: text,
  bank_routing: digits(9, 'routing'),
  bank_city: text,
  bank_state: state,
  officers: z.preprocess((v) => {
    try {
      return typeof v === 'string' ? JSON.parse(v) : []
    } catch {
      return []
    }
  }, z.array(z.unknown()).max(8)),
})

export type SaveProfileState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string> }

export async function saveBusinessProfileAction(
  _prev: SaveProfileState,
  formData: FormData,
): Promise<SaveProfileState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireOwner(ctx.tenantId)

  const raw = Object.fromEntries(Object.keys(profileSchema.shape).map((k) => [k, formData.get(k) ?? '']))
  const parsed = profileSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { error: 'invalid', fieldErrors }
  }
  const v = parsed.data
  const officers = normalizeOfficers(v.officers).filter((o) => Object.values(o).some(Boolean))

  const { error } = await supabase.from('tenant_business_profile').upsert(
    {
      tenant_id: ctx.tenantId,
      ...v,
      // A physical address equal to the mailing one is not kept twice.
      ...(v.physical_same
        ? { physical_address1: null, physical_address2: null, physical_city: null, physical_state: null, physical_zip: null, physical_type: null }
        : {}),
      officers: officers as unknown as Json,
      updated_by: userId,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return { error: error.message }

  // The EIN and bank are not copied into the audit trail.
  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'update',
    tableName: 'tenant_business_profile',
    recordId: ctx.tenantId,
    changes: { kind: 'business_profile_saved', officers: officers.length },
  })

  revalidatePath('/government-forms')
  return { ok: true }
}

/** Save a form's answers (type of action, ...) so the next fill starts there. */
export async function saveFormAnswersAction(
  formId: string,
  answers: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireOwner(ctx.tenantId)

  const form = agencyForm(formId)
  if (!form) return { ok: false, error: 'unknown_form' }
  const clean = answersFor(form, answers)

  const { profile } = await loadBusinessProfile(supabase, ctx.tenantId)
  const { error } = await supabase.from('tenant_business_profile').upsert(
    {
      tenant_id: ctx.tenantId,
      ...profile,
      officers: profile.officers as unknown as Json,
      form_answers: { ...profile.form_answers, [form.id]: clean } as unknown as Json,
      updated_by: userId,
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
