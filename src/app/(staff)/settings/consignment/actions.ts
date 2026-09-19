'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const SETTINGS_ROLES = ['owner', 'chain_admin'] as const

export type UpdateConsignmentSettingsState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
}

const schema = z.object({
  consignment_enabled: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.boolean(),
  ),
  // Fraction, matching the column and the accrual trigger (0.2 = 20%).
  consignment_default_commission_pct: z.coerce.number().min(0).max(1),
})

export async function updateConsignmentSettingsAction(
  _prev: UpdateConsignmentSettingsState,
  formData: FormData,
): Promise<UpdateConsignmentSettingsState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  await requireRoleInTenant(ctx.tenantId, SETTINGS_ROLES)

  const parsed = schema.safeParse({
    consignment_enabled: formData.get('consignment_enabled'),
    consignment_default_commission_pct: formData.get(
      'consignment_default_commission_pct',
    ),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message
    }
    return { error: 'validation_failed', fieldErrors }
  }
  const v = parsed.data

  const admin = createAdminClient()
  const { data: prior } = await admin
    .from('settings')
    .select('consignment_enabled, consignment_default_commission_pct')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  const { error } = await admin
    .from('settings')
    .update({
      consignment_enabled: v.consignment_enabled,
      consignment_default_commission_pct:
        v.consignment_default_commission_pct,
    })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: { kind: 'consignment_settings', before: prior, after: v },
  })

  revalidatePath('/settings')
  revalidatePath('/settings/consignment')
  revalidatePath('/consignors')
  revalidatePath('/inventory')
  return { ok: true }
}
