'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { JURISDICTION_COLUMNS } from '@/lib/jurisdictions/load'
import { toJurisdiction } from '@/lib/jurisdictions/rules'
import { SHOP_TIMEZONES } from '@/lib/jurisdictions/timezones'

const optionalDays = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().int().min(0).max(3650).nullable(),
  )
  .transform((v) => v ?? null)

const schema = z.object({
  jurisdiction_code: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().regex(/^(US|CA)-[A-Z]{2}$/).nullable(),
    )
    .transform((v) => v ?? null),
  timezone: z.enum(SHOP_TIMEZONES),
  grace_period_days: optionalDays,
  buy_hold_period_days: z.coerce.number().int().min(0).max(365),
  abandoned_repair_days: z.coerce.number().int().min(1).max(3650),
})

export type SaveComplianceState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

/**
 * Owner-only: pick the jurisdiction + timezone and set the tenant's own
 * (stricter-or-equal) grace / hold / abandon periods. Values below the
 * statutory minimum are rejected here; the effective value is floored at
 * the statute everywhere else anyway (loadTenantRules / DB helpers).
 */
export async function saveComplianceSettingsAction(
  _prev: SaveComplianceState,
  formData: FormData,
): Promise<SaveComplianceState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const tenantId = ctx.tenantId

  const { userId } = await requireRoleInTenant(tenantId, ['owner', 'chain_admin'])

  const parsed = schema.safeParse({
    jurisdiction_code: formData.get('jurisdiction_code'),
    timezone: formData.get('timezone'),
    grace_period_days: formData.get('grace_period_days'),
    buy_hold_period_days: formData.get('buy_hold_period_days'),
    abandoned_repair_days: formData.get('abandoned_repair_days'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = 'invalid'
    }
    return { fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()

  if (v.jurisdiction_code) {
    const { data: row } = await admin
      .from('jurisdictions')
      .select(JURISDICTION_COLUMNS)
      .eq('code', v.jurisdiction_code)
      .eq('is_active', true)
      .maybeSingle()
    if (!row) return { fieldErrors: { jurisdiction_code: 'invalid' } }
    const j = toJurisdiction(row)
    const fieldErrors: Record<string, string> = {}
    if (v.grace_period_days != null && v.grace_period_days < j.grace_days) {
      fieldErrors.grace_period_days = `below_statute:${j.grace_days}`
    }
    if (v.buy_hold_period_days < j.buy_hold_days) {
      fieldErrors.buy_hold_period_days = `below_statute:${j.buy_hold_days}`
    }
    if (
      j.repair_abandon_days != null &&
      v.abandoned_repair_days < j.repair_abandon_days
    ) {
      fieldErrors.abandoned_repair_days = `below_statute:${j.repair_abandon_days}`
    }
    if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  }

  const { error: tErr } = await admin
    .from('tenants')
    .update({ jurisdiction_code: v.jurisdiction_code, timezone: v.timezone })
    .eq('id', tenantId)
  if (tErr) return { error: tErr.message }

  const { error: sErr } = await admin
    .from('settings')
    .update({
      grace_period_days: v.grace_period_days,
      buy_hold_period_days: v.buy_hold_period_days,
      abandoned_repair_days: v.abandoned_repair_days,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
  if (sErr) return { error: sErr.message }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'tenants',
    recordId: tenantId,
    changes: {
      jurisdiction_code: v.jurisdiction_code,
      timezone: v.timezone,
      grace_period_days: v.grace_period_days,
      buy_hold_period_days: v.buy_hold_period_days,
      abandoned_repair_days: v.abandoned_repair_days,
    },
  })

  revalidatePath('/settings/compliance')
  revalidatePath('/settings')
  revalidatePath('/pawn/new')
  revalidatePath('/buy/new')
  return { ok: true }
}
