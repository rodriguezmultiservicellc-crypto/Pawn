import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createCustomer, retrieveCustomer } from '@/lib/stripe/saas'

/**
 * Ensure a Stripe Customer exists for a tenant. Idempotent:
 *   - If tenant_subscriptions.stripe_customer_id is set and the customer
 *     still exists in Stripe, return it.
 *   - Otherwise create a new customer with metadata.tenant_id stamped
 *     and persist the id (upserting tenant_subscriptions if no row).
 *
 * The default plan when creating an empty subscription row is the lowest-
 * priced active plan (sort_order ascending). The webhook will overwrite
 * plan_id once Checkout completes, so this is just a placeholder.
 */
export async function ensureStripeCustomerForTenant(args: {
  tenantId: string
  email?: string | null
  name?: string | null
}): Promise<string> {
  const admin = createAdminClient()

  const { data: sub } = await admin
    .from('tenant_subscriptions')
    .select('stripe_customer_id, plan_id')
    .eq('tenant_id', args.tenantId)
    .maybeSingle()

  if (sub?.stripe_customer_id) {
    try {
      const c = await retrieveCustomer(sub.stripe_customer_id)
      return c.id
    } catch {
      // Customer was deleted from Stripe (rare — usually only happens in
      // test mode account resets). Fall through and create a new one.
    }
  }

  const newCustomer = await createCustomer({
    email: args.email ?? null,
    name: args.name ?? null,
    metadata: { tenant_id: args.tenantId },
  })

  if (sub) {
    const { error } = await admin
      .from('tenant_subscriptions')
      .update({ stripe_customer_id: newCustomer.id })
      .eq('tenant_id', args.tenantId)
    if (error) {
      throw new Error(`update_subscription_failed: ${error.message}`)
    }
  } else {
    // No subscription row yet — pick the lowest-priced active plan as a
    // placeholder so plan_id (NOT NULL) is satisfied. Status stays
    // 'incomplete' until the webhook upgrades it after a successful
    // Checkout.
    const { data: defaultPlan, error: planErr } = await admin
      .from('subscription_plans')
      .select('id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (planErr || !defaultPlan) {
      throw new Error(
        `no_default_plan: ${planErr?.message ?? 'subscription_plans empty'}`,
      )
    }
    const { error } = await admin.from('tenant_subscriptions').insert({
      tenant_id: args.tenantId,
      plan_id: defaultPlan.id,
      status: 'incomplete',
      billing_cycle: 'monthly',
      stripe_customer_id: newCustomer.id,
    })
    if (error) {
      throw new Error(`create_subscription_failed: ${error.message}`)
    }
  }

  return newCustomer.id
}
