'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const SETTINGS_ROLES = ['owner', 'chain_admin', 'manager'] as const

export type UpdateCustomQuoteSettingsState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

/** Form posts whole-number percents; the DB stores fractions. */
const pct = z.coerce.number().min(0).max(95)

const schema = z.object({
  default_margin: pct,
  min_margin: pct,
  default_deposit: z.coerce.number().min(0).max(100),
  expiry_days: z.coerce.number().int().min(1).max(365),
  labor_rate: z.coerce.number().min(0).max(100_000),
  show_cost_breakdown: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
})

export async function updateCustomQuoteSettingsAction(
  _prev: UpdateCustomQuoteSettingsState,
  formData: FormData,
): Promise<UpdateCustomQuoteSettingsState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  await requireRoleInTenant(ctx.tenantId, SETTINGS_ROLES)

  const parsed = schema.safeParse({
    default_margin: formData.get('default_margin'),
    min_margin: formData.get('min_margin'),
    default_deposit: formData.get('default_deposit'),
    expiry_days: formData.get('expiry_days'),
    labor_rate: formData.get('labor_rate'),
    show_cost_breakdown: formData.get('show_cost_breakdown'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !fieldErrors[k]) fieldErrors[k] = 'invalid'
    }
    return { error: 'invalid', fieldErrors }
  }
  const v = parsed.data
  if (v.min_margin > v.default_margin) {
    return { error: 'min_above_default', fieldErrors: { min_margin: 'min_above_default' } }
  }

  const after = {
    custom_quote_default_margin_pct: v.default_margin / 100,
    custom_quote_min_margin_pct: v.min_margin / 100,
    custom_quote_default_deposit_pct: v.default_deposit / 100,
    custom_quote_expiry_days: v.expiry_days,
    custom_quote_labor_rate: v.labor_rate,
    custom_quote_show_cost_breakdown: v.show_cost_breakdown,
  }

  const admin = createAdminClient()
  const { data: prior } = await admin
    .from('settings')
    .select(
      'custom_quote_default_margin_pct, custom_quote_min_margin_pct, custom_quote_default_deposit_pct, custom_quote_expiry_days, custom_quote_labor_rate, custom_quote_show_cost_breakdown',
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  const { error } = await admin.from('settings').update(after).eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'custom_quote_settings',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: { before: prior, after },
  })

  revalidatePath('/settings')
  revalidatePath('/settings/custom-quotes')
  revalidatePath('/repair/quotes')
  return { ok: true }
}
