'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/supabase/guards'
import { parseRateTiers, parseTicketNotices } from '@/lib/jurisdictions/rules'
import { SHOP_TIMEZONES } from '@/lib/jurisdictions/timezones'
import type { Json } from '@/types/database'

const blankToNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? null : v

const optInt = (min: number, max: number) =>
  z.preprocess(blankToNull, z.coerce.number().int().min(min).max(max).nullable())
const optNum = (min: number, max: number) =>
  z.preprocess(blankToNull, z.coerce.number().min(min).max(max).nullable())
const optText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable())

const schema = z
  .object({
    country: z.enum(['US', 'CA']),
    region: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    name: z.string().trim().min(2).max(80),
    statute: optText(300),
    default_timezone: z.enum(SHOP_TIMEZONES),
    rate_cap_percent: optNum(0.01, 100),
    period_days: z.coerce.number().int().min(1).max(365),
    min_charge_cap: optNum(0, 100000),
    min_term_days: optInt(1, 365),
    max_term_days: optInt(1, 365),
    grace_days: z.coerce.number().int().min(0).max(730),
    grace_rolls_to_business_day: z.boolean(),
    buy_hold_days: z.coerce.number().int().min(0).max(365),
    repair_abandon_days: optInt(1, 3650),
    record_retention_years: optInt(1, 25),
    police_reporting_required: z.boolean(),
    rate_tiers_json: optText(4000),
    ticket_notices_json: z.string().trim().max(20000),
    ticket_backpage: optText(40000),
    notes: optText(4000),
    verified_on: z.preprocess(
      blankToNull,
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    ),
    verified_source: optText(500),
    is_active: z.boolean(),
  })
  .refine(
    (v) =>
      v.min_term_days == null ||
      v.max_term_days == null ||
      v.min_term_days <= v.max_term_days,
    { path: ['max_term_days'], message: 'term_range' },
  )

export type SaveJurisdictionState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

function parseJson(raw: string | null): { ok: true; value: Json | null } | { ok: false } {
  if (raw == null || raw === '') return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(raw) as Json }
  } catch {
    return { ok: false }
  }
}

/** Superadmin-only create / update of a jurisdictions row (patches/0048). */
export async function saveJurisdictionAction(
  _prev: SaveJurisdictionState,
  formData: FormData,
): Promise<SaveJurisdictionState> {
  const { admin, userId } = await requireSuperAdmin()

  const existingCode = String(formData.get('existing_code') ?? '').trim() || null

  const parsed = schema.safeParse({
    country: formData.get('country'),
    region: formData.get('region'),
    name: formData.get('name'),
    statute: formData.get('statute'),
    default_timezone: formData.get('default_timezone'),
    rate_cap_percent: formData.get('rate_cap_percent'),
    period_days: formData.get('period_days'),
    min_charge_cap: formData.get('min_charge_cap'),
    min_term_days: formData.get('min_term_days'),
    max_term_days: formData.get('max_term_days'),
    grace_days: formData.get('grace_days'),
    grace_rolls_to_business_day: formData.get('grace_rolls_to_business_day') === 'on',
    buy_hold_days: formData.get('buy_hold_days'),
    repair_abandon_days: formData.get('repair_abandon_days'),
    record_retention_years: formData.get('record_retention_years'),
    police_reporting_required: formData.get('police_reporting_required') === 'on',
    rate_tiers_json: formData.get('rate_tiers_json'),
    ticket_notices_json: formData.get('ticket_notices_json') ?? '[]',
    ticket_backpage: formData.get('ticket_backpage'),
    notes: formData.get('notes'),
    verified_on: formData.get('verified_on'),
    verified_source: formData.get('verified_source'),
    is_active: formData.get('is_active') === 'on',
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
  const code = `${v.country}-${v.region}`
  if (existingCode && existingCode !== code) {
    return { fieldErrors: { region: 'code_immutable' } }
  }

  const tiers = parseJson(v.rate_tiers_json)
  if (!tiers.ok || (tiers.value != null && parseRateTiers(tiers.value) == null)) {
    return { fieldErrors: { rate_tiers_json: 'invalid_tiers' } }
  }
  const notices = parseJson(v.ticket_notices_json || '[]')
  if (!notices.ok || !Array.isArray(notices.value)) {
    return { fieldErrors: { ticket_notices_json: 'invalid_notices' } }
  }
  const cleanNotices = parseTicketNotices(notices.value)
  if (cleanNotices.length !== notices.value.length) {
    return { fieldErrors: { ticket_notices_json: 'invalid_notices' } }
  }

  const row = {
    code,
    country: v.country,
    region: v.region,
    name: v.name,
    statute: v.statute,
    default_timezone: v.default_timezone,
    rate_cap_monthly: v.rate_cap_percent == null ? null : v.rate_cap_percent / 100,
    rate_tiers: tiers.value,
    period_days: v.period_days,
    min_charge_cap: v.min_charge_cap,
    min_term_days: v.min_term_days,
    max_term_days: v.max_term_days,
    grace_days: v.grace_days,
    grace_rolls_to_business_day: v.grace_rolls_to_business_day,
    buy_hold_days: v.buy_hold_days,
    repair_abandon_days: v.repair_abandon_days,
    record_retention_years: v.record_retention_years,
    police_reporting_required: v.police_reporting_required,
    ticket_notices: cleanNotices as unknown as Json,
    ticket_backpage: v.ticket_backpage,
    notes: v.notes,
    verified_on: v.verified_on,
    verified_source: v.verified_source,
    is_active: v.is_active,
    updated_by: userId,
  }

  const { error } = existingCode
    ? await admin.from('jurisdictions').update(row).eq('code', existingCode)
    : await admin.from('jurisdictions').insert(row)
  if (error) {
    return { error: error.code === '23505' ? 'duplicate_code' : error.message }
  }

  revalidatePath('/admin/jurisdictions')
  if (!existingCode) redirect(`/admin/jurisdictions/${code}`)
  return { ok: true }
}
