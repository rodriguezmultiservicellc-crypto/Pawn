'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const usStateRe = /^[A-Z]{2}$/

const generalSchema = z.object({
  name: z.string().trim().min(1, 'required').max(120),
  dba: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(120).nullable().optional(),
    )
    .transform((v) => v ?? null),
  address: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(200).nullable().optional(),
    )
    .transform((v) => v ?? null),
  city: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(80).nullable().optional(),
    )
    .transform((v) => v ?? null),
  state: z
    .preprocess(
      (v) =>
        typeof v === 'string' && v.trim() === '' ? null : v?.toString().toUpperCase(),
      z.string().regex(usStateRe).nullable().optional(),
    )
    .transform((v) => v ?? null),
  zip: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(3).max(10).nullable().optional(),
    )
    .transform((v) => v ?? null),
  phone: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(7).max(40).nullable().optional(),
    )
    .transform((v) => v ?? null),
  email: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().email().nullable().optional(),
    )
    .transform((v) => v ?? null),
  agency_store_id: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v?.toString().trim()),
      z.string().min(1).max(64).nullable().optional(),
    )
    .transform((v) => v ?? null),
})

export type UpdateGeneralState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

/**
 * Update tenant identity + contact. Owner / chain_admin only — module
 * flags (has_pawn / has_repair / has_retail) and police_report_format
 * are intentionally NOT editable here. Module flags affect billing
 * (the SaaS plan gates limit how many shops a chain can have, etc.)
 * so they're owner+platform decisions made via /admin/tenants. The
 * police-report format is a compliance setting that has to be
 * coordinated with the actual agency.
 */
export async function updateGeneralAction(
  _prev: UpdateGeneralState,
  formData: FormData,
): Promise<UpdateGeneralState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
  ])

  const echo: Record<string, string> = {}
  for (const k of [
    'name',
    'dba',
    'address',
    'city',
    'state',
    'zip',
    'phone',
    'email',
    'agency_store_id',
  ]) {
    const v = formData.get(k)
    if (typeof v === 'string') echo[k] = v
  }

  const parsed = generalSchema.safeParse({
    name: formData.get('name'),
    dba: formData.get('dba'),
    address: formData.get('address'),
    city: formData.get('city'),
    state: formData.get('state'),
    zip: formData.get('zip'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    agency_store_id: formData.get('agency_store_id'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors, values: echo }
  }

  const v = parsed.data

  const admin = createAdminClient()
  // agency_store_id lands via 0024-tenant-agency-store-id.sql; the
  // autogen Database type picks it up after `npm run db:types`. Until
  // then the field is unknown to TS — split the writes so the typed
  // base columns stay typed and the new column rides along separately.
  const { error } = await admin
    .from('tenants')
    .update({
      name: v.name,
      dba: v.dba,
      address: v.address,
      city: v.city,
      state: v.state,
      zip: v.zip,
      phone: v.phone,
      email: v.email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.tenantId)
  if (!error) {
    const { error: agencyError } = await admin
      .from('tenants')
      .update({ agency_store_id: v.agency_store_id } as never)
      .eq('id', ctx.tenantId)
    if (agencyError) {
      return { error: agencyError.message, values: echo }
    }
  }

  if (error) {
    return { error: error.message, values: echo }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'update',
    tableName: 'tenants',
    recordId: ctx.tenantId,
    changes: {
      // Don't log the actual values — the audit-viewer is staff-readable
      // and tenant info isn't sensitive but logging only the field set
      // keeps the noise down.
      fields_changed: [
        'name',
        'dba',
        'address',
        'city',
        'state',
        'zip',
        'phone',
        'email',
        'agency_store_id',
      ],
    },
  })

  revalidatePath('/settings')
  revalidatePath('/settings/general')
  return { ok: true }
}
