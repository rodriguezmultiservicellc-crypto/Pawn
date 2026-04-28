/**
 * Pure types + pure helpers for the SaaS billing surface.
 *
 * Lives outside `server-only` so client components can import shapes
 * (TenantBillingRow, SubscriptionPlan) and pure formatters (formatCents,
 * statusTone) without dragging the admin Supabase client into a client
 * bundle.
 */

import type { Database } from '@/types/database'

export type SubscriptionPlan = Database['public']['Tables']['subscription_plans']['Row']
export type TenantSubscription = Database['public']['Tables']['tenant_subscriptions']['Row']
export type SubscriptionStatus = Database['public']['Enums']['subscription_status']
export type BillingCycle = Database['public']['Enums']['billing_cycle']

export type TenantBillingRow = {
  tenant: { id: string; name: string; tenant_type: string | null }
  subscription: TenantSubscription | null
  plan: {
    id: string
    code: string
    name: string
    price_monthly_cents: number
    price_yearly_cents: number | null
  } | null
}

/** Format a cents amount as USD currency. Cents are stored to keep math
 *  integer-safe (Stripe convention). */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  })
}

/** Tone classes used by status pills in the admin UI. */
export function statusTone(
  status: SubscriptionStatus,
): 'success' | 'warning' | 'error' | 'muted' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'success'
    case 'past_due':
    case 'incomplete':
      return 'warning'
    case 'unpaid':
    case 'cancelled':
    case 'incomplete_expired':
      return 'error'
    default:
      return 'muted'
  }
}

export function isTrialing(sub: TenantSubscription): boolean {
  return sub.status === 'trialing'
}

export function trialDaysRemaining(sub: TenantSubscription): number | null {
  if (!sub.trial_ends_at) return null
  const ms = new Date(sub.trial_ends_at).getTime() - Date.now()
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0
}

export function planFeatures(plan: SubscriptionPlan): string[] {
  const v = plan.features
  return Array.isArray(v) ? (v as string[]) : []
}

export function planHasFeature(plan: SubscriptionPlan, feature: string): boolean {
  return planFeatures(plan).includes(feature)
}

export function planLimit(
  plan: SubscriptionPlan,
  key: string,
): number | null {
  const v = plan.feature_limits as unknown as Record<string, number | null> | null
  return v?.[key] ?? null
}
