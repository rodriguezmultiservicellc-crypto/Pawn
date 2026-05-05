'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

const SETTINGS_ROLES = ['owner', 'chain_admin'] as const

export type UpdateLoyaltySettingsState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
}

const loyaltySettingsSchema = z.object({
  loyalty_enabled: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
  loyalty_earn_rate_retail: z.coerce.number().min(0).max(1000),
  loyalty_earn_rate_loan_interest: z.coerce.number().min(0).max(1000),
  loyalty_redemption_rate: z.coerce.number().gt(0).max(100000),
  loyalty_referral_bonus: z.coerce.number().int().min(0).max(1_000_000),
})

export async function updateLoyaltySettingsAction(
  _prev: UpdateLoyaltySettingsState,
  formData: FormData,
): Promise<UpdateLoyaltySettingsState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Role guard (Rule 10 — guard before admin client).
  await requireRoleInTenant(ctx.tenantId, SETTINGS_ROLES)

  const parsed = loyaltySettingsSchema.safeParse({
    loyalty_enabled: formData.get('loyalty_enabled'),
    loyalty_earn_rate_retail: formData.get('loyalty_earn_rate_retail'),
    loyalty_earn_rate_loan_interest: formData.get('loyalty_earn_rate_loan_interest'),
    loyalty_redemption_rate: formData.get('loyalty_redemption_rate'),
    loyalty_referral_bonus: formData.get('loyalty_referral_bonus'),
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
    .select(
      'loyalty_enabled, loyalty_earn_rate_retail, loyalty_earn_rate_loan_interest, loyalty_redemption_rate, loyalty_referral_bonus',
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  const { error } = await admin
    .from('settings')
    .update({
      loyalty_enabled: v.loyalty_enabled,
      loyalty_earn_rate_retail: v.loyalty_earn_rate_retail,
      loyalty_earn_rate_loan_interest: v.loyalty_earn_rate_loan_interest,
      loyalty_redemption_rate: v.loyalty_redemption_rate,
      loyalty_referral_bonus: v.loyalty_referral_bonus,
    })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'update',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: {
      kind: 'loyalty_settings',
      before: prior,
      after: v,
    },
  })

  revalidatePath('/settings')
  revalidatePath('/settings/loyalty')
  revalidatePath('/customers')
  revalidatePath('/portal/loyalty')
  return { ok: true }
}
