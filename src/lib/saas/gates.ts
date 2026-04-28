import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { planFeatures, planLimit } from './types'
import type { SubscriptionPlan } from './types'

/**
 * Plan-tier feature & limit gates.
 *
 * Two-stage check to keep the call sites cheap:
 *   - checkPlanFeature(tenantId, feature) -> { allowed, reason }
 *   - checkPlanLimit(tenantId, limitKey, currentCount)
 *       -> { allowed, limit, current, reason }
 *
 * Both resolve the tenant's active plan via tenant_subscriptions →
 * subscription_plans. When no subscription row exists (e.g. a brand-new
 * tenant before checkout), we fall back to the lowest-priced active plan
 * (sort_order ascending) so default behavior is the most conservative.
 *
 * Servers should `require*` versions throw — they're convenient at the
 * top of server actions where you want a hard stop.
 */

export type GateCheck =
  | { allowed: true; planCode: string; planName: string }
  | { allowed: false; reason: string; planCode: string | null; planName: string | null }

export type LimitCheck =
  | {
      allowed: true
      planCode: string
      planName: string
      limit: number | null
      current: number
    }
  | {
      allowed: false
      reason: string
      planCode: string | null
      planName: string | null
      limit: number | null
      current: number
    }

export class PlanGateError extends Error {
  readonly planCode: string | null
  readonly limit: number | null
  readonly current: number | null
  readonly feature: string | null

  constructor(args: {
    message: string
    planCode: string | null
    limit?: number | null
    current?: number | null
    feature?: string | null
  }) {
    super(args.message)
    this.name = 'PlanGateError'
    this.planCode = args.planCode
    this.limit = args.limit ?? null
    this.current = args.current ?? null
    this.feature = args.feature ?? null
  }
}

/**
 * Resolve the active plan for a tenant. Returns null only when there are
 * no active plans seeded at all (which would be a deployment bug).
 */
async function resolveActivePlan(tenantId: string): Promise<SubscriptionPlan | null> {
  const admin = createAdminClient()

  const { data: sub } = await admin
    .from('tenant_subscriptions')
    .select('plan_id, status')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  // If there's a subscription, use its plan regardless of status — feature
  // gates fire based on what the tenant agreed to. Status-based degradation
  // (past_due / unpaid downgrades) is handled separately so we don't cut
  // off paid features at the moment a card declines.
  if (sub?.plan_id) {
    const { data: plan } = await admin
      .from('subscription_plans')
      .select('*')
      .eq('id', sub.plan_id)
      .maybeSingle()
    if (plan) return plan
  }

  // Fallback: the lowest-priced active plan acts as the default. New
  // tenants start there until they upgrade.
  const { data: defaultPlan } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  return defaultPlan
}

export async function checkPlanFeature(
  tenantId: string,
  feature: string,
): Promise<GateCheck> {
  const plan = await resolveActivePlan(tenantId)
  if (!plan) {
    return {
      allowed: false,
      reason: 'no_plan_configured',
      planCode: null,
      planName: null,
    }
  }
  if (!planFeatures(plan).includes(feature)) {
    return {
      allowed: false,
      reason: `feature_not_in_plan:${feature}`,
      planCode: plan.code,
      planName: plan.name,
    }
  }
  return { allowed: true, planCode: plan.code, planName: plan.name }
}

export async function requirePlanFeature(
  tenantId: string,
  feature: string,
): Promise<void> {
  const check = await checkPlanFeature(tenantId, feature)
  if (!check.allowed) {
    throw new PlanGateError({
      message: `plan_gate:${check.reason}`,
      planCode: check.planCode,
      feature,
    })
  }
}

export async function checkPlanLimit(
  tenantId: string,
  limitKey: string,
  currentCount: number,
): Promise<LimitCheck> {
  const plan = await resolveActivePlan(tenantId)
  if (!plan) {
    return {
      allowed: false,
      reason: 'no_plan_configured',
      planCode: null,
      planName: null,
      limit: null,
      current: currentCount,
    }
  }

  const limit = planLimit(plan, limitKey)
  // null = unlimited
  if (limit == null) {
    return {
      allowed: true,
      planCode: plan.code,
      planName: plan.name,
      limit: null,
      current: currentCount,
    }
  }

  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `limit_reached:${limitKey}`,
      planCode: plan.code,
      planName: plan.name,
      limit,
      current: currentCount,
    }
  }

  return {
    allowed: true,
    planCode: plan.code,
    planName: plan.name,
    limit,
    current: currentCount,
  }
}

export async function requirePlanLimit(
  tenantId: string,
  limitKey: string,
  currentCount: number,
): Promise<void> {
  const check = await checkPlanLimit(tenantId, limitKey, currentCount)
  if (!check.allowed) {
    throw new PlanGateError({
      message: `plan_gate:${check.reason}`,
      planCode: check.planCode,
      limit: check.limit,
      current: check.current,
    })
  }
}

// ── Resource counters ────────────────────────────────────────────────────
//
// Counts used by the limit gates. Stay close to the gate so callers don't
// have to remember which tables to query.

export async function countActiveLoans(tenantId: string): Promise<number> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'extended', 'partial_paid'])
    .is('deleted_at', null)
  return count ?? 0
}

export async function countActiveUserTenants(tenantId: string): Promise<number> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('user_tenants')
    .select('user_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
  return count ?? 0
}

/** Count the child shops under a chain_hq tenant. Used by multi_shop
 *  feature gate when adding another shop to a chain. */
export async function countChildTenants(parentTenantId: string): Promise<number> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('parent_tenant_id', parentTenantId)
    .eq('is_active', true)
  return count ?? 0
}
