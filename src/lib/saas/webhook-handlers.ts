import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import type { Database } from '@/types/database'

type SubscriptionStatus = Database['public']['Enums']['subscription_status']
type BillingCycle = Database['public']['Enums']['billing_cycle']

// ── Minimal Stripe response shapes ──────────────────────────────────────
//
// We type only the fields we read so the rest of the payload doesn't need
// declaring. Anything not listed here is intentionally unused.

export type StripeSubscriptionItem = {
  price: {
    id: string
    product: string
    recurring: { interval: 'day' | 'week' | 'month' | 'year' } | null
  }
}

export type StripeSubscription = {
  id: string
  customer: string
  status: string
  metadata: Record<string, string>
  items: { data: StripeSubscriptionItem[] }
  current_period_start: number | null
  current_period_end: number | null
  trial_end: number | null
  cancel_at_period_end: boolean
  canceled_at: number | null
  cancellation_details?: {
    reason?: string | null
    comment?: string | null
  } | null
}

export type StripeInvoice = {
  id: string
  customer: string
  subscription: string | null
  status: string
  amount_due: number
  amount_paid: number
  total: number
  currency: string
  period_start: number | null
  period_end: number | null
  due_date: number | null
  status_transitions?: { paid_at: number | null } | null
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  billing_reason: string | null
}

export type StripeEvent = {
  id: string
  type: string
  created: number
  data: { object: unknown }
}

// ── Mapping helpers ─────────────────────────────────────────────────────

/** Stripe spells it 'canceled'; our enum stores 'cancelled'. Map anything
 *  unknown (e.g. 'paused') to a safe-but-loud bucket so we surface it via
 *  audit but don't crash. */
function mapStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return stripeStatus
    case 'canceled':
      return 'cancelled'
    case 'paused':
      // Stripe pauses subscriptions when the operator opts in — treat like
      // past_due so feature gates still degrade. Audit log captures the
      // raw Stripe value.
      return 'past_due'
    default:
      return 'incomplete'
  }
}

function isoFromUnix(unix: number | null | undefined): string | null {
  if (unix == null || !Number.isFinite(unix)) return null
  return new Date(unix * 1000).toISOString()
}

/** Resolve the cycle from a subscription's first item's price interval. */
function cycleFromSubscription(sub: StripeSubscription): BillingCycle {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval
  return interval === 'year' ? 'yearly' : 'monthly'
}

// ── Tenant resolution ───────────────────────────────────────────────────

/**
 * Find our tenant_id for a Stripe event. Prefer metadata.tenant_id (we
 * stamp it on every checkout we initiate). Fall back to looking up
 * tenant_subscriptions.stripe_customer_id — covers the case where a
 * subscription was created outside our flow (e.g. test mode, support).
 *
 * Returns null when no match — webhook handler logs and returns 200 so
 * Stripe doesn't retry forever.
 */
async function resolveTenantId(args: {
  metadataTenantId?: string | null
  stripeCustomerId: string
}): Promise<string | null> {
  if (args.metadataTenantId) return args.metadataTenantId
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenant_subscriptions')
    .select('tenant_id')
    .eq('stripe_customer_id', args.stripeCustomerId)
    .maybeSingle()
  return data?.tenant_id ?? null
}

async function resolvePlanId(stripeProductId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscription_plans')
    .select('id')
    .eq('stripe_product_id', stripeProductId)
    .maybeSingle()
  return data?.id ?? null
}

// ── Handlers ────────────────────────────────────────────────────────────

export async function handleSubscriptionUpsert(
  sub: StripeSubscription,
): Promise<{ ok: boolean; tenantId: string | null; reason?: string }> {
  const tenantId = await resolveTenantId({
    metadataTenantId: sub.metadata?.tenant_id ?? null,
    stripeCustomerId: sub.customer,
  })
  if (!tenantId) return { ok: false, tenantId: null, reason: 'no_tenant' }

  const productId = sub.items?.data?.[0]?.price?.product ?? null
  const planId = productId ? await resolvePlanId(productId) : null
  if (!planId) {
    return { ok: false, tenantId, reason: `unknown_plan_for_product:${productId}` }
  }

  const admin = createAdminClient()
  const status = mapStatus(sub.status)
  const billingCycle = cycleFromSubscription(sub)

  const { error } = await admin
    .from('tenant_subscriptions')
    .upsert(
      {
        tenant_id: tenantId,
        plan_id: planId,
        status,
        billing_cycle: billingCycle,
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        trial_ends_at: isoFromUnix(sub.trial_end),
        current_period_start: isoFromUnix(sub.current_period_start),
        current_period_end: isoFromUnix(sub.current_period_end),
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        cancelled_at: isoFromUnix(sub.canceled_at),
        cancel_reason: sub.cancellation_details?.reason ?? null,
      },
      { onConflict: 'tenant_id' },
    )

  if (error) {
    return { ok: false, tenantId, reason: `db_upsert: ${error.message}` }
  }

  await logAudit({
    tenantId,
    userId: null,
    action: 'tenant_plan_change',
    tableName: 'tenant_subscriptions',
    recordId: tenantId,
    changes: {
      flow: 'webhook_subscription_upsert',
      stripe_event_status: sub.status,
      mapped_status: status,
      cycle: billingCycle,
      plan_id: planId,
      stripe_subscription_id: sub.id,
    },
  })

  return { ok: true, tenantId }
}

export async function handleSubscriptionDeleted(
  sub: StripeSubscription,
): Promise<{ ok: boolean; tenantId: string | null; reason?: string }> {
  const tenantId = await resolveTenantId({
    metadataTenantId: sub.metadata?.tenant_id ?? null,
    stripeCustomerId: sub.customer,
  })
  if (!tenantId) return { ok: false, tenantId: null, reason: 'no_tenant' }

  const admin = createAdminClient()
  const cancelledAtIso =
    isoFromUnix(sub.canceled_at) ?? new Date().toISOString()

  const { error } = await admin
    .from('tenant_subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: cancelledAtIso,
      cancel_at_period_end: false,
      cancel_reason: sub.cancellation_details?.reason ?? null,
    })
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, tenantId, reason: `db_update: ${error.message}` }

  await logAudit({
    tenantId,
    userId: null,
    action: 'tenant_plan_change',
    tableName: 'tenant_subscriptions',
    recordId: tenantId,
    changes: {
      flow: 'webhook_subscription_deleted',
      stripe_subscription_id: sub.id,
      cancelled_at: cancelledAtIso,
    },
  })

  return { ok: true, tenantId }
}

export async function handleInvoicePaid(
  invoice: StripeInvoice,
): Promise<{ ok: boolean; tenantId: string | null; reason?: string }> {
  if (!invoice.subscription) {
    return { ok: false, tenantId: null, reason: 'no_subscription_on_invoice' }
  }

  const tenantId = await resolveTenantId({
    metadataTenantId: null,
    stripeCustomerId: invoice.customer,
  })
  if (!tenantId) return { ok: false, tenantId: null, reason: 'no_tenant' }

  const admin = createAdminClient()
  const paidAtIso =
    isoFromUnix(invoice.status_transitions?.paid_at ?? null) ??
    new Date().toISOString()

  // Cache row in billing_invoices.
  const { error: invErr } = await admin.from('billing_invoices').upsert(
    {
      tenant_id: tenantId,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.total,
      currency: (invoice.currency ?? 'usd').toLowerCase(),
      status: invoice.status,
      period_start: isoFromUnix(invoice.period_start),
      period_end: isoFromUnix(invoice.period_end),
      due_date: isoFromUnix(invoice.due_date),
      paid_at: paidAtIso,
      hosted_invoice_url: invoice.hosted_invoice_url,
      invoice_pdf_url: invoice.invoice_pdf,
    },
    { onConflict: 'stripe_invoice_id' },
  )
  if (invErr) {
    return { ok: false, tenantId, reason: `invoices_upsert: ${invErr.message}` }
  }

  // Snapshot onto the parent subscription row for fast UI rendering.
  const { error: subErr } = await admin
    .from('tenant_subscriptions')
    .update({
      last_invoice_id: invoice.id,
      last_invoice_amount_cents: invoice.total,
      last_invoice_paid_at: paidAtIso,
    })
    .eq('tenant_id', tenantId)
  if (subErr) {
    return { ok: false, tenantId, reason: `sub_snapshot: ${subErr.message}` }
  }

  await logAudit({
    tenantId,
    userId: null,
    action: 'tenant_plan_change',
    tableName: 'billing_invoices',
    recordId: invoice.id,
    changes: {
      flow: 'webhook_invoice_paid',
      amount_cents: invoice.total,
      currency: invoice.currency,
    },
  })

  return { ok: true, tenantId }
}

export async function handleInvoicePaymentFailed(
  invoice: StripeInvoice,
): Promise<{ ok: boolean; tenantId: string | null; reason?: string }> {
  const tenantId = await resolveTenantId({
    metadataTenantId: null,
    stripeCustomerId: invoice.customer,
  })
  if (!tenantId) return { ok: false, tenantId: null, reason: 'no_tenant' }

  const admin = createAdminClient()

  const { error } = await admin.from('billing_invoices').upsert(
    {
      tenant_id: tenantId,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.total,
      currency: (invoice.currency ?? 'usd').toLowerCase(),
      status: invoice.status,
      period_start: isoFromUnix(invoice.period_start),
      period_end: isoFromUnix(invoice.period_end),
      due_date: isoFromUnix(invoice.due_date),
      paid_at: null,
      hosted_invoice_url: invoice.hosted_invoice_url,
      invoice_pdf_url: invoice.invoice_pdf,
    },
    { onConflict: 'stripe_invoice_id' },
  )
  if (error) {
    return { ok: false, tenantId, reason: `invoices_upsert: ${error.message}` }
  }

  await logAudit({
    tenantId,
    userId: null,
    action: 'tenant_plan_change',
    tableName: 'billing_invoices',
    recordId: invoice.id,
    changes: {
      flow: 'webhook_invoice_payment_failed',
      amount_cents: invoice.total,
      currency: invoice.currency,
      due_date_unix: invoice.due_date,
    },
  })

  // Dunning email is wired in chunk 5. For now, the audit row is the
  // signal — operator can grep the audit log for failed invoices.
  return { ok: true, tenantId }
}

export async function handleTrialWillEnd(
  sub: StripeSubscription,
): Promise<{ ok: boolean; tenantId: string | null }> {
  const tenantId = await resolveTenantId({
    metadataTenantId: sub.metadata?.tenant_id ?? null,
    stripeCustomerId: sub.customer,
  })
  if (!tenantId) return { ok: false, tenantId: null }

  await logAudit({
    tenantId,
    userId: null,
    action: 'tenant_plan_change',
    tableName: 'tenant_subscriptions',
    recordId: tenantId,
    changes: {
      flow: 'webhook_trial_will_end',
      trial_end: isoFromUnix(sub.trial_end),
      stripe_subscription_id: sub.id,
    },
  })

  // Dunning-style "your trial ends in 3 days" email lands in chunk 5.
  return { ok: true, tenantId }
}
