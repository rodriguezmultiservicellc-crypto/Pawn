import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActivePlans } from '@/lib/saas/plans'
import { getTenantSubscription } from '@/lib/saas/subscriptions'
import BillingContent from './content'

export const dynamic = 'force-dynamic'

/**
 * Self-service billing for tenant owners. Shows the current plan +
 * status, the three plan tiers with monthly/yearly toggle, and recent
 * invoices. Upgrade / change-plan buttons hit /api/stripe/saas/checkout
 * and redirect to the hosted Stripe Checkout.
 *
 * Owner / chain_admin only — gated by requireOwner. Superadmins can
 * still hit /admin/billing for the multi-tenant operator view.
 */
export default async function StaffBillingPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Defense-in-depth role gate.
  await requireOwner(ctx.tenantId)

  const admin = createAdminClient()

  const [plans, subscription, invoicesRes, tenantRes] = await Promise.all([
    getActivePlans(),
    getTenantSubscription(ctx.tenantId),
    admin
      .from('billing_invoices')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('tenants')
      .select('id, name, dba')
      .eq('id', ctx.tenantId)
      .maybeSingle(),
  ])

  const currentPlan =
    subscription?.plan_id != null
      ? plans.find((p) => p.id === subscription.plan_id) ?? null
      : null

  return (
    <Suspense fallback={<div className="text-sm text-ash">Loading…</div>}>
      <BillingContent
        tenantId={ctx.tenantId}
        tenantName={tenantRes.data?.dba ?? tenantRes.data?.name ?? ''}
        plans={plans}
        subscription={subscription}
        currentPlan={currentPlan}
        invoices={invoicesRes.data ?? []}
      />
    </Suspense>
  )
}
