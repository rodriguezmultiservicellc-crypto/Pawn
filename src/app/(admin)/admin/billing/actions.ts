'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { setTenantPlan } from '@/lib/saas/subscriptions'
import { logAudit } from '@/lib/audit'
import type { Database } from '@/types/database'

type SubscriptionStatus = Database['public']['Enums']['subscription_status']
type BillingCycle = Database['public']['Enums']['billing_cycle']

const ALLOWED_STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
]

const ALLOWED_CYCLES: BillingCycle[] = ['monthly', 'yearly']

export type SetTenantPlanState = {
  error?: string
  ok?: boolean
}

export async function setTenantPlanAction(
  _prev: SetTenantPlanState,
  formData: FormData,
): Promise<SetTenantPlanState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (ctx.globalRole !== 'superadmin') {
    return { error: 'forbidden' }
  }

  const tenantId = String(formData.get('tenant_id') ?? '').trim()
  const planId = String(formData.get('plan_id') ?? '').trim()
  const status = String(formData.get('status') ?? 'trialing').trim() as SubscriptionStatus
  const billingCycle = String(
    formData.get('billing_cycle') ?? 'monthly',
  ).trim() as BillingCycle
  const trialDaysStr = String(formData.get('trial_days') ?? '').trim()
  const internalNotes = String(formData.get('internal_notes') ?? '').trim()

  if (!tenantId || !planId) return { error: 'tenant_id_and_plan_id_required' }
  if (!ALLOWED_STATUSES.includes(status)) return { error: 'bad_status' }
  if (!ALLOWED_CYCLES.includes(billingCycle)) return { error: 'bad_cycle' }

  let trialEndsAt: string | null = null
  if (status === 'trialing' && trialDaysStr !== '') {
    const days = Number.parseInt(trialDaysStr, 10)
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return { error: 'bad_trial_days' }
    }
    trialEndsAt = new Date(
      Date.now() + days * 86_400_000,
    ).toISOString()
  }

  try {
    await setTenantPlan({
      tenantId,
      planId,
      status,
      billingCycle,
      trialEndsAt,
      internalNotes: internalNotes || null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return { error: msg }
  }

  await logAudit({
    tenantId,
    userId: ctx.userId,
    action: 'tenant_plan_change',
    tableName: 'tenant_subscriptions',
    recordId: tenantId,
    changes: {
      plan_id: planId,
      status,
      billing_cycle: billingCycle,
      trial_ends_at: trialEndsAt,
    },
  })

  revalidatePath('/admin/billing')
  return { ok: true }
}
