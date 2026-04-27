/**
 * Stripe Terminal — server-side PaymentIntent creation for card-present
 * payments at the POS.
 *
 * SCOPE FOR THIS PHASE:
 *   - Create a PaymentIntent on the per-tenant Connect account
 *     (`tenant_billing_settings.stripe_account_id`) with
 *     `payment_method_types: ['card_present']` and
 *     `capture_method: 'automatic'`.
 *   - Cancel a PaymentIntent (reader timeout / clerk back-out).
 *   - Refund a card payment (return flow).
 *
 * DEFERRED (next agent, when hardware is available):
 *   - Browser-side reader pairing via `@stripe/terminal-js` (createTerminal,
 *     discoverReaders, connectReader, collectPaymentMethod, processPayment).
 *   - Webhook plumbing for `payment_intent.succeeded` / `.payment_failed`
 *     to write back card_present_status on the sale_payments row.
 *   - Real BBPOS WisePOS E / S700 firmware testing.
 *
 * Until that lands, the POS UI ships a TEST-only "Mark as succeeded" shortcut
 * (see /pos/sales/[id]/actions.ts: markCardPaymentSucceededAction). This
 * lets us smoke-test the surrounding code paths without real hardware.
 *
 * ENV VARS REQUIRED:
 *   STRIPE_SECRET_KEY — platform-level (used to act on behalf of the
 *                       connected account via Stripe-Account header).
 *
 * RUNTIME:
 *   This file is server-only — never import from a client component.
 *   The actions in /pos/.../actions.ts call these helpers AFTER guarding
 *   tenant + role.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

function stripeSecretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY
  if (!k) {
    throw new Error('stripe_secret_key_missing')
  }
  return k
}

/**
 * Look up the connected account ID for a tenant. Throws
 * 'tenant_stripe_not_connected' when the tenant hasn't completed Connect
 * onboarding yet — surfaced cleanly in the action layer.
 */
async function getStripeAccountId(tenantId: string): Promise<string> {
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
 * URL-encode a record for Stripe's form-encoded body.
 */
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

export type CardPresentPaymentIntent = {
  id: string
  client_secret: string | null
  status: string
  amount: number
  currency: string
}

/**
 * Create a card-present PaymentIntent on the tenant's connected account.
 * Amount is dollars (numeric(18,4)) — converted to integer cents inline.
 */
export async function createCardPresentPaymentIntent(args: {
  tenantId: string
  amount: number
  saleId: string
  currency?: string
  description?: string
  metadata?: Record<string, string>
}): Promise<CardPresentPaymentIntent> {
  const accountId = await getStripeAccountId(args.tenantId)
  const cents = Math.max(1, Math.round(args.amount * 100))
  const currency = (args.currency ?? 'usd').toLowerCase()

  const body: Record<string, string | number> = {
    amount: cents,
    currency,
    'payment_method_types[0]': 'card_present',
    capture_method: 'automatic',
    description: args.description ?? `Sale ${args.saleId}`,
    'metadata[tenant_id]': args.tenantId,
    'metadata[sale_id]': args.saleId,
  }
  if (args.metadata) {
    for (const [k, v] of Object.entries(args.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }

  return stripeFetch<CardPresentPaymentIntent>('/payment_intents', {
    method: 'POST',
    body,
    accountId,
  })
}

/**
 * Cancel a PaymentIntent (reader timeout / clerk back-out).
 */
export async function cancelPaymentIntent(args: {
  tenantId: string
  paymentIntentId: string
}): Promise<{ id: string; status: string }> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<{ id: string; status: string }>(
    `/payment_intents/${encodeURIComponent(args.paymentIntentId)}/cancel`,
    {
      method: 'POST',
      accountId,
    },
  )
}

/**
 * Refund a card payment. Used by the return action when the original
 * payment was on a card and the customer wants their card credited.
 */
export async function refundCardPayment(args: {
  tenantId: string
  paymentIntentId: string
  amount: number
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  metadata?: Record<string, string>
}): Promise<{ id: string; status: string; amount: number }> {
  const accountId = await getStripeAccountId(args.tenantId)
  const cents = Math.max(1, Math.round(args.amount * 100))
  const body: Record<string, string | number> = {
    payment_intent: args.paymentIntentId,
    amount: cents,
    reason: args.reason ?? 'requested_by_customer',
  }
  if (args.metadata) {
    for (const [k, v] of Object.entries(args.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }
  return stripeFetch<{ id: string; status: string; amount: number }>(
    '/refunds',
    {
      method: 'POST',
      body,
      accountId,
    },
  )
}
