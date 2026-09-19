'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const SETTINGS_ROLES = ['owner', 'chain_admin'] as const

export type UpdateStoreCreditSettingsState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
}

const schema = z.object({
  store_credit_enabled: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.boolean(),
  ),
  store_credit_expiry_days: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce.number().int().min(1).max(3650).nullable(),
    )
    .transform((v) => (v == null ? null : v)),
})

export async function updateStoreCreditSettingsAction(
  _prev: UpdateStoreCreditSettingsState,
  formData: FormData,
): Promise<UpdateStoreCreditSettingsState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Guard before the admin client (Rule 10).
  await requireRoleInTenant(ctx.tenantId, SETTINGS_ROLES)

  const parsed = schema.safeParse({
    store_credit_enabled: formData.get('store_credit_enabled'),
    store_credit_expiry_days: formData.get('store_credit_expiry_days'),
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
    .select('store_credit_enabled, store_credit_expiry_days')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  const { error } = await admin
    .from('settings')
    .update({
      store_credit_enabled: v.store_credit_enabled,
      store_credit_expiry_days: v.store_credit_expiry_days,
    })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: { kind: 'store_credit_settings', before: prior, after: v },
  })

  revalidatePath('/settings')
  revalidatePath('/settings/store-credit')
  revalidatePath('/customers')
  return { ok: true }
}
