import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateSubscriptionPrice } from '@/lib/stripe/saas'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/stripe/saas/change-plan
 *
 * Body (JSON):
 *   { tenant_id: string, plan_code: string,
 *     cycle: 'monthly' | 'yearly' }
 *
 * Auth:
 *   Owner / chain_admin at the target tenant, OR superadmin.
 *
 * Returns:
 *   { ok: true, subscription_id: string } — the local DB will be
 *   reconciled by the customer.subscription.updated webhook event
 *   that Stripe fires after this call. The UI shows a "your plan
 *   will update once Stripe confirms" banner via ?changed=1.
 *
 * vs /api/stripe/saas/checkout: that endpoint creates a brand-new
 * subscription via hosted Checkout. This endpoint mutates an existing
 * subscription's price — proration handled by Stripe.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: { tenant_id?: string; plan_code?: string; cycle?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const tenantId = (body.tenant_id ?? '').trim()
  const planCode = (body.plan_code ?? '').trim()
  const cycle = body.cycle === 'yearly' ? 'yearly' : 'monthly'

  if (!tenantId || !planCode) {
    return NextResponse.json(
      { error: 'tenant_id_and_plan_code_required' },
      { status: 400 },
    )
  }

  // Auth: superadmin OR owner/chain_admin.
  if (ctx.globalRole !== 'superadmin') {
    const { data: ut } = await ctx.supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', ctx.userId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle()

    let ok = ut?.role === 'owner' || ut?.role === 'chain_admin'
    if (!ok) {
      const { data: tenant } = await ctx.supabase
        .from('tenants')
        .select('parent_tenant_id')
        .eq('id', tenantId)
        .maybeSingle()
      if (tenant?.parent_tenant_id) {
        const { data: chainAdmin } = await ctx.supabase
          .from('user_tenants')
          .select('role')
          .eq('user_id', ctx.userId)
          .eq('tenant_id', tenant.parent_tenant_id)
          .eq('role', 'chain_admin')
          .eq('is_active', true)
          .maybeSingle()
        ok = !!chainAdmin
      }
    }
    if (!ok) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const admin = createAdminClient()

  const [planRes, subRes] = await Promise.all([
    admin
      .from('subscription_plans')
      .select(
        'id, code, name, stripe_price_monthly_id, stripe_price_yearly_id, is_active',
      )
      .eq('code', planCode)
      .maybeSingle(),
    admin
      .from('tenant_subscriptions')
      .select('plan_id, status, billing_cycle, stripe_subscription_id')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  if (planRes.error || !planRes.data) {
    return NextResponse.json({ error: 'plan_not_found' }, { status: 404 })
  }
  if (!planRes.data.is_active) {
    return NextResponse.json({ error: 'plan_inactive' }, { status: 400 })
  }

  const sub = subRes.data
  if (!sub?.stripe_subscription_id) {
    return NextResponse.json(
      { error: 'no_active_subscription_use_checkout' },
      { status: 409 },
    )
  }

  // Idempotency: if they already have this exact plan + cycle, no-op.
  if (
    sub.plan_id === planRes.data.id &&
    sub.billing_cycle === cycle
  ) {
    return NextResponse.json({
      ok: true,
      subscription_id: sub.stripe_subscription_id,
      no_op: true,
    })
  }

  const newPriceId =
    cycle === 'monthly'
      ? planRes.data.stripe_price_monthly_id
      : planRes.data.stripe_price_yearly_id
  if (!newPriceId) {
    return NextResponse.json(
      { error: 'plan_not_synced_to_stripe' },
      { status: 409 },
    )
  }

  let updated
  try {
    updated = await updateSubscriptionPrice({
      subscriptionId: sub.stripe_subscription_id,
      newPriceId,
      prorationBehavior: 'create_prorations',
      metadata: {
        tenant_id: tenantId,
        plan_code: planRes.data.code,
        cycle,
      },
      // Idempotency-key bound to the (tenant, plan, cycle, sub) tuple
      // so a button-mash double-click doesn't double-bill.
      idempotencyKey: `pawn_change_${tenantId}_${planRes.data.code}_${cycle}_${sub.stripe_subscription_id}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json(
      { error: `stripe_update_failed: ${msg}` },
      { status: 500 },
    )
  }

  await logAudit({
    tenantId,
    userId: ctx.userId,
    action: 'tenant_plan_change',
    tableName: 'tenant_subscriptions',
    recordId: tenantId,
    changes: {
      flow: 'change_plan_endpoint',
      from_plan_id: sub.plan_id,
      to_plan_code: planRes.data.code,
      cycle,
      stripe_subscription_id: updated.id,
    },
  })

  return NextResponse.json({
    ok: true,
    subscription_id: updated.id,
  })
}
