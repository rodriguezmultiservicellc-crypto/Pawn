/**
 * Stripe Payment Links (online, customer portal) — server-side helpers.
 *
 * SCOPE FOR THIS PHASE:
 *   - Create a hosted Stripe Checkout Session on the per-tenant Connect
 *     account (Stripe-Account header = tenant_billing_settings
 *     .stripe_account_id) for two payment kinds:
 *       loan_payoff      — pay the current payoff balance on a pawn loan
 *       layaway_payment  — make a payment toward a layaway balance
 *   - Cancel an unused session (let it expire on Stripe — we just mark our
 *     stripe_payment_links row 'cancelled').
 *
 * RUNTIME:
 *   Server-only. Never import from a client component. The portal server
 *   actions in src/app/(portal)/portal/loans/[id]/actions.ts and
 *   src/app/(portal)/portal/layaways/[id]/actions.ts call these helpers
 *   AFTER guarding the client + tenant via requireClientInTenant().
 *
 * ENV VARS REQUIRED:
 *   STRIPE_SECRET_KEY     — platform-level (acts on the connected account
 *                            via Stripe-Account header).
 *   NEXT_PUBLIC_APP_URL   — canonical origin for success/cancel return URLs.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

export type PaymentLinkKind = 'loan_payoff' | 'layaway_payment'

function stripeSecretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY
  if (!k) {
    throw new Error('stripe_secret_key_missing')
  }
  return k
}

function appBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL
  if (!u) {
    throw new Error('next_public_app_url_missing')
  }
  // Strip trailing slash so we can concatenate paths predictably.
  return u.replace(/\/$/, '')
}

/**
 * Look up the connected account ID for a tenant. Throws
 * 'tenant_stripe_not_connected' when the tenant hasn't completed Connect
 * onboarding yet — the action layer surfaces it as a friendly error.
 */
export async function getStripeAccountIdForTenant(
  tenantId: string,
): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tenant_billing_settings')
    .select('stripe_account_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    throw new Error(`tenant_billing_lookup_failed: ${error.message}`)
  }
  if (!data?.stripe_account_id) {
    throw new Error('tenant_stripe_not_connected')
  }
  return data.stripe_account_id
}

/**
 * Non-throwing variant. Used by portal pages that should still RENDER
 * loan / layaway detail (with due dates + balances) even when the
 * tenant hasn't onboarded Stripe Connect yet — they just hide the
 * "Pay online" button and show a "pay in store" notice instead.
 */
export async function isTenantStripeConnected(
  tenantId: string,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenant_billing_settings')
    .select('stripe_account_id, billing_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return !!(data?.stripe_account_id && data.billing_enabled !== false)
}

function encodeForm(body: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) {
    params.append(k, String(v))
  }
  return params.toString()
}

async function stripeFetch<T>(
  path: string,
  init: {
    method: 'POST' | 'GET'
    body?: Record<string, string | number>
    accountId?: string
  },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeSecretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (init.accountId) {
    headers['Stripe-Account'] = init.accountId
  }
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body ? encodeForm(init.body) : undefined,
    cache: 'no-store',
  })
  const json = (await res.json()) as unknown
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message ??
      `stripe_http_${res.status}`
    throw new Error(msg)
  }
  return json as T
}

export type CheckoutSession = {
  id: string
  url: string | null
  status: string | null
  payment_status?: string | null
  payment_intent?: string | null
  amount_total: number | null
  currency: string | null
  client_reference_id: string | null
  metadata?: Record<string, string> | null
}

/**
 * Create a hosted Checkout Session on the tenant's connected account for a
 * one-time payment. Used by portal actions for both loan payoff and
 * layaway payments.
 *
 * Amount is dollars (numeric(18,4)) — converted to integer cents inline.
 */
export async function createCheckoutSession(args: {
  tenantId: string
  kind: PaymentLinkKind
  /** loanId for 'loan_payoff', layawayId for 'layaway_payment'. */
  sourceId: string
  customerId: string
  amount: number
  currency?: string
  /** Description shown on the hosted checkout page (e.g. "Loan PT-000123 payoff"). */
  description: string
  /** Path to return to on success/cancel. We append ?session_id=... on success. */
  returnPath: string
  customerEmail?: string | null
  metadata?: Record<string, string>
}): Promise<CheckoutSession> {
  const accountId = await getStripeAccountIdForTenant(args.tenantId)
  const cents = Math.max(1, Math.round(args.amount * 100))
  const currency = (args.currency ?? 'usd').toLowerCase()
  const base = appBaseUrl()
  const successUrl = `${base}${args.returnPath}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${base}${args.returnPath}?cancelled=1`

  const body: Record<string, string | number> = {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': cents,
    'line_items[0][price_data][product_data][name]': args.description,
    'line_items[0][quantity]': 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: args.sourceId,
    'metadata[tenant_id]': args.tenantId,
    'metadata[kind]': args.kind,
    'metadata[source_id]': args.sourceId,
    'metadata[customer_id]': args.customerId,
  }
  if (args.customerEmail) {
    body['customer_email'] = args.customerEmail
  }
  if (args.metadata) {
    for (const [k, v] of Object.entries(args.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }

  return stripeFetch<CheckoutSession>('/checkout/sessions', {
    method: 'POST',
    body,
    accountId,
  })
}

/**
 * Retrieve a Checkout Session by id on the connected account. Used by the
 * webhook handler when the event payload is checkout.session.completed —
 * Stripe ships only ids in the event in some integrations; we re-fetch to
 * be sure we have payment_intent + amount_total + payment_status.
 */
export async function retrieveCheckoutSession(args: {
  tenantId: string
  sessionId: string
}): Promise<CheckoutSession> {
  const accountId = await getStripeAccountIdForTenant(args.tenantId)
  return stripeFetch<CheckoutSession>(
    `/checkout/sessions/${encodeURIComponent(args.sessionId)}`,
    {
      method: 'GET',
      accountId,
    },
  )
}

/**
 * Expire a Checkout Session. Used when the customer cancels and we want
 * to flip the row to 'cancelled' immediately (Stripe also expires sessions
 * automatically after 24h, but we want a clean state in our table).
 */
export async function expireCheckoutSession(args: {
  tenantId: string
  sessionId: string
}): Promise<{ id: string; status: string }> {
  const accountId = await getStripeAccountIdForTenant(args.tenantId)
  return stripeFetch<{ id: string; status: string }>(
    `/checkout/sessions/${encodeURIComponent(args.sessionId)}/expire`,
    {
      method: 'POST',
      accountId,
    },
  )
}
