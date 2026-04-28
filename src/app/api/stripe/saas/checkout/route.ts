import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureStripeCustomerForTenant } from '@/lib/saas/customer'
import { createSubscriptionCheckoutSession } from '@/lib/stripe/saas'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/stripe/saas/checkout
 *
 * Body (JSON):
 *   { tenant_id: string, plan_code: string, cycle: 'monthly' | 'yearly',
 *     return_path?: string, trial_days?: number }
 *
 * Auth:
 *   Requires owner / chain_admin at the target tenant, OR globalRole=
 *   'superadmin'. Superadmins are allowed to start a checkout on a
 *   tenant's behalf for support cases.
 *
 * Returns:
 *   { url: string } — the Stripe Checkout Session URL the client should
 *   redirect to.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: {
    tenant_id?: string
    plan_code?: string
    cycle?: string
    return_path?: string
    trial_days?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const tenantId = (body.tenant_id ?? '').trim()
  const planCode = (body.plan_code ?? '').trim()
  const cycle = body.cycle === 'yearly' ? 'yearly' : 'monthly'
  const returnPath =
    typeof body.return_path === 'string' && body.return_path.startsWith('/')
      ? body.return_path
      : '/staff/billing'
  const trialDays =
    typeof body.trial_days === 'number' && body.trial_days >= 0
      ? Math.min(365, Math.floor(body.trial_days))
      : null

  if (!tenantId || !planCode) {
    return NextResponse.json(
      { error: 'tenant_id_and_plan_code_required' },
      { status: 400 },
    )
  }

  // Auth: superadmin OR owner/chain_admin at the tenant.
  if (ctx.globalRole !== 'superadmin') {
    // requireOwner redirects on failure; for an API route we want a JSON
    // error instead. Reproduce its check inline against the user-scoped
    // client (RLS ensures we only see our own user_tenants rows).
    const { data: ut } = await ctx.supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', ctx.userId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle()

    let ok = ut?.role === 'owner' || ut?.role === 'chain_admin'
    if (!ok) {
      // Chain-admin-on-parent fallback.
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

  const { data: plan, error: planErr } = await admin
    .from('subscription_plans')
    .select(
      'id, code, name, stripe_product_id, stripe_price_monthly_id, stripe_price_yearly_id, is_active',
    )
    .eq('code', planCode)
    .maybeSingle()
  if (planErr || !plan) {
    return NextResponse.json({ error: 'plan_not_found' }, { status: 404 })
  }
  if (!plan.is_active) {
    return NextResponse.json({ error: 'plan_inactive' }, { status: 400 })
  }

  const priceId =
    cycle === 'monthly'
      ? plan.stripe_price_monthly_id
      : plan.stripe_price_yearly_id
  if (!priceId) {
    return NextResponse.json(
      { error: 'plan_not_synced_to_stripe' },
      { status: 409 },
    )
  }

  // Look up tenant info for the customer record.
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, email')
    .eq('id', tenantId)
    .maybeSingle()
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 })
  }

  let customerId: string
  try {
    customerId = await ensureStripeCustomerForTenant({
      tenantId,
      email: tenant.email,
      name: tenant.name,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json(
      { error: `customer_failed: ${msg}` },
      { status: 500 },
    )
  }

  let session
  try {
    session = await createSubscriptionCheckoutSession({
      customerId,
      priceId,
      tenantId,
      planCode: plan.code,
      cycle,
      returnPath,
      trialDays,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json(
      { error: `checkout_failed: ${msg}` },
      { status: 500 },
    )
  }

  if (!session.url) {
    return NextResponse.json({ error: 'no_session_url' }, { status: 500 })
  }

  await logAudit({
    tenantId,
    userId: ctx.userId,
    action: 'tenant_plan_change',
    tableName: 'tenant_subscriptions',
    recordId: tenantId,
    changes: {
      flow: 'checkout_session_created',
      plan_code: plan.code,
      cycle,
      stripe_session_id: session.id,
    },
  })

  return NextResponse.json({ url: session.url })
}
