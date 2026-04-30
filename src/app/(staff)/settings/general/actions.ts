'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { isReservedOrInvalidSlug } from '@/lib/tenant-resolver'

const usStateRe = /^[A-Z]{2}$/
const slugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
const HOURS_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type HoursKey = (typeof HOURS_KEYS)[number]
type HoursDay = { open: string | null; close: string | null; closed: boolean }
type HoursPayload = Partial<Record<HoursKey, HoursDay>>

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
  public_slug: z
    .preprocess(
      (v) =>
        typeof v === 'string' && v.trim() === ''
          ? null
          : v?.toString().trim().toLowerCase(),
      z
        .string()
        .min(3, 'Slug must be at least 3 characters')
        .max(40, 'Slug must be 40 characters or fewer')
        .regex(slugRe, 'Lowercase letters, digits, and hyphens only')
        .nullable()
        .optional(),
    )
    .transform((v) => v ?? null),
  public_landing_enabled: z
    .preprocess((v) => v === 'on' || v === true || v === 'true', z.boolean()),
  public_about: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(2000).nullable().optional(),
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
    'public_slug',
    'public_about',
  ]) {
    const v = formData.get(k)
    if (typeof v === 'string') echo[k] = v
  }
  for (const day of HOURS_KEYS) {
    for (const part of ['open', 'close', 'closed'] as const) {
      const k = `hours_${day}_${part}`
      const v = formData.get(k)
      if (typeof v === 'string') echo[k] = v
    }
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
    public_slug: formData.get('public_slug'),
    public_landing_enabled: formData.get('public_landing_enabled'),
    public_about: formData.get('public_about'),
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

  // Reserved-slug + cross-validate constraints. Done after Zod so we can
  // cite specific fields rather than form-level errors.
  if (v.public_slug && isReservedOrInvalidSlug(v.public_slug)) {
    return {
      fieldErrors: {
        public_slug:
          'This slug is reserved or not allowed. Try a different one.',
      },
      values: echo,
    }
  }
  if (v.public_landing_enabled && !v.public_slug) {
    return {
      fieldErrors: {
        public_slug: 'Set a slug before publishing the landing page.',
      },
      values: echo,
    }
  }

  // Hours payload from form fields. Validation lives here (not Zod)
  // because the shape is a fanout across 21 fields and the cross-day
  // rules are easier as imperative code.
  const hoursResult = buildHoursPayload(formData)
  if (!hoursResult.ok) {
    return {
      fieldErrors: { public_hours: hoursResult.error },
      values: echo,
    }
  }
  const hoursPayload = hoursResult.data

  const admin = createAdminClient()

  // Slug uniqueness pre-check: scope to OTHER tenants. The DB UNIQUE
  // partial index is the authority — this check just produces a
  // user-friendly field error instead of a raw constraint violation.
  if (v.public_slug) {
    const { data: dupe } = await admin
      .from('tenants')
      .select('id')
      .eq('public_slug', v.public_slug)
      .neq('id', ctx.tenantId)
      .limit(1)
      .maybeSingle()
    if (dupe) {
      return {
        fieldErrors: {
          public_slug: 'This slug is already taken by another shop.',
        },
        values: echo,
      }
    }
  }

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
      agency_store_id: v.agency_store_id,
      public_slug: v.public_slug,
      public_landing_enabled: v.public_landing_enabled,
      public_about: v.public_about,
      public_hours: hoursPayload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.tenantId)
  if (error) {
    // Surface the UNIQUE-constraint violation as a slug field error so
    // the user can recover (the pre-check above usually catches it but
    // a TOCTOU window is possible).
    if (
      typeof error.message === 'string' &&
      error.message.toLowerCase().includes('public_slug')
    ) {
      return {
        fieldErrors: {
          public_slug: 'This slug is already taken by another shop.',
        },
        values: echo,
      }
    }
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
        'public_slug',
        'public_landing_enabled',
        'public_about',
        'public_hours',
      ],
    },
  })

  revalidatePath('/settings')
  revalidatePath('/settings/general')
  if (v.public_slug) revalidatePath(`/s/${v.public_slug}`)
  return { ok: true }
}

function buildHoursPayload(
  formData: FormData,
):
  | { ok: true; data: HoursPayload | null }
  | { ok: false; error: string } {
  const result: HoursPayload = {}
  for (const day of HOURS_KEYS) {
    const open = (
      (formData.get(`hours_${day}_open`) as string | null) ?? ''
    ).trim()
    const close = (
      (formData.get(`hours_${day}_close`) as string | null) ?? ''
    ).trim()
    const closed = formData.get(`hours_${day}_closed`) === 'on'

    if (closed) {
      result[day] = { open: null, close: null, closed: true }
      continue
    }
    if (!open && !close) continue
    if (!open || !close) {
      return {
        ok: false,
        error: `${day.toUpperCase()}: enter both open and close, or tick Closed.`,
      }
    }
    if (!timeRe.test(open) || !timeRe.test(close)) {
      return {
        ok: false,
        error: `${day.toUpperCase()}: use 24-hour HH:MM format (e.g. 09:00).`,
      }
    }
    if (open >= close) {
      return {
        ok: false,
        error: `${day.toUpperCase()}: close time must be after open time.`,
      }
    }
    result[day] = { open, close, closed: false }
  }
  return { ok: true, data: Object.keys(result).length > 0 ? result : null }
}
