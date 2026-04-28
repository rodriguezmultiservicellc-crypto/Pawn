import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  BillingCycle,
  SubscriptionStatus,
  TenantBillingRow,
  TenantSubscription,
} from './types'

export type {
  BillingCycle,
  SubscriptionStatus,
  TenantBillingRow,
  TenantSubscription,
} from './types'
export { isTrialing, trialDaysRemaining, statusTone } from './types'

export async function getTenantSubscription(
  tenantId: string,
): Promise<TenantSubscription | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenant_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

export async function listTenantBilling(): Promise<TenantBillingRow[]> {
  const admin = createAdminClient()
  // Tenants are the spine — every tenant should appear, even those without
  // a subscription row yet.
  const { data: tenants, error } = await admin
    .from('tenants')
    .select('id, name, tenant_type')
    .order('name', { ascending: true })
  if (error) throw new Error(`failed to load tenants: ${error.message}`)

  const tenantIds = (tenants ?? []).map((t) => t.id)
  if (tenantIds.length === 0) return []

  const [{ data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('tenant_subscriptions')
      .select('*')
      .in('tenant_id', tenantIds),
    admin
      .from('subscription_plans')
      .select('id, code, name, price_monthly_cents, price_yearly_cents'),
  ])

  const subByTenant = new Map<string, TenantSubscription>()
  for (const s of subs ?? []) subByTenant.set(s.tenant_id, s)
  const planById = new Map<string, NonNullable<TenantBillingRow['plan']>>()
  for (const p of plans ?? []) planById.set(p.id, p)

  return (tenants ?? []).map((t) => {
    const sub = subByTenant.get(t.id) ?? null
    const plan = sub ? (planById.get(sub.plan_id) ?? null) : null
    return {
      tenant: { id: t.id, name: t.name, tenant_type: t.tenant_type ?? null },
      subscription: sub,
      plan,
    }
  })
}

/** Upsert a tenant_subscriptions row. Used by the admin "Set plan" action.
 *  Stripe is not yet wired — this just sets the local DB state so the
 *  app's feature gates start working right away. Once platform Stripe is
 *  onboarded, the webhook will overwrite stripe_customer_id /
 *  stripe_subscription_id / status / period bounds. */
export async function setTenantPlan(args: {
  tenantId: string
  planId: string
  status: SubscriptionStatus
  billingCycle: BillingCycle
  trialEndsAt?: string | null
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  internalNotes?: string | null
}): Promise<TenantSubscription> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tenant_subscriptions')
    .upsert(
      {
        tenant_id: args.tenantId,
        plan_id: args.planId,
        status: args.status,
        billing_cycle: args.billingCycle,
        trial_ends_at: args.trialEndsAt ?? null,
        current_period_start: args.currentPeriodStart ?? null,
        current_period_end: args.currentPeriodEnd ?? null,
        internal_notes: args.internalNotes ?? null,
      },
      { onConflict: 'tenant_id' },
    )
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`setTenantPlan failed: ${error?.message ?? 'no row'}`)
  }
  return data
}
