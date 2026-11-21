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
 *   - `payment_intent.payment_failed` → card_present_status 'failed'.
 *   - Real BBPOS WisePOS E / S700 firmware testing.
 *
 * HOW A CARD TENDER COUNTS (patches/0071, lib/pos/card-settle.ts):
 *   Creating the PaymentIntent adds a 'pending' sale_payments row and does
 *   NOT touch sales.paid_total. The tender counts when it settles — the
 *   Stripe webhook on `payment_intent.succeeded`, or an owner / manager /
 *   chain_admin confirming the reader approved it
 *   (/pos/sales/[id]/actions.ts: confirmCardPaymentAction). A sale cannot
 *   complete on a pending card.
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
import { stripeFetch } from './http'
import { isStripeTestKey } from '@/lib/pos/reader'

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

// ── Server-driven reader (patches/0086) ─────────────────────────────────────
//
// One paired reader per shop (Pawn runs one open register per shop). The
// app pushes each PaymentIntent to the reader and polls the intent — no
// browser SDK, no reader discovery in the browser. Every call acts on the
// shop's connected account.

/** True when the platform key is a Stripe TEST key (simulated readers allowed). */
export function stripeTestMode(): boolean {
  return isStripeTestKey(process.env.STRIPE_SECRET_KEY)
}

/** The shop has completed Stripe Connect onboarding (an account id exists). */
export async function tenantHasStripeAccount(tenantId: string): Promise<boolean> {
  try {
    await getStripeAccountId(tenantId)
    return true
  } catch {
    return false
  }
}

export type StripeReader = {
  id: string
  label: string | null
  device_type: string | null
  status: 'online' | 'offline' | null
  serial_number: string | null
  action: {
    type?: string | null
    status?: string | null
    failure_message?: string | null
    process_payment_intent?: { payment_intent?: string | { id: string } | null } | null
  } | null
}

/** Create the shop's Terminal Location (Stripe requires one per reader). */
export async function createTerminalLocation(args: {
  tenantId: string
  displayName: string
  address: { line1: string; city: string; state: string; postal_code: string }
}): Promise<{ id: string }> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<{ id: string }>('/terminal/locations', {
    method: 'POST',
    accountId,
    body: {
      display_name: args.displayName.slice(0, 100),
      'address[line1]': args.address.line1,
      'address[city]': args.address.city,
      'address[state]': args.address.state,
      'address[postal_code]': args.address.postal_code,
      'address[country]': 'US',
      'metadata[tenant_id]': args.tenantId,
    },
  })
}

/** Pair a reader with the code it shows on screen (test mode: 'simulated-wpe'). */
export async function registerTerminalReader(args: {
  tenantId: string
  registrationCode: string
  label: string
  locationId: string
}): Promise<StripeReader> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<StripeReader>('/terminal/readers', {
    method: 'POST',
    accountId,
    body: {
      registration_code: args.registrationCode,
      label: args.label.slice(0, 60),
      location: args.locationId,
      'metadata[tenant_id]': args.tenantId,
    },
  })
}

export async function getTerminalReader(args: { tenantId: string; readerId: string }): Promise<StripeReader> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<StripeReader>(`/terminal/readers/${encodeURIComponent(args.readerId)}`, {
    method: 'GET',
    accountId,
  })
}

export async function deleteTerminalReader(args: { tenantId: string; readerId: string }): Promise<void> {
  const accountId = await getStripeAccountId(args.tenantId)
  await stripeFetch<{ id: string; deleted?: boolean }>(`/terminal/readers/${encodeURIComponent(args.readerId)}`, {
    method: 'DELETE',
    accountId,
  })
}

/** Hand a PaymentIntent to the reader; it starts asking for the card. */
export async function processPaymentIntentOnReader(args: {
  tenantId: string
  readerId: string
  paymentIntentId: string
}): Promise<StripeReader> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<StripeReader>(
    `/terminal/readers/${encodeURIComponent(args.readerId)}/process_payment_intent`,
    {
      method: 'POST',
      accountId,
      body: {
        payment_intent: args.paymentIntentId,
        // No tip screen at a pawn counter.
        'process_config[skip_tipping]': true,
      },
    },
  )
}

/** Stop whatever the reader is doing (clerk cancelled at the counter). */
export async function cancelReaderAction(args: { tenantId: string; readerId: string }): Promise<StripeReader> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<StripeReader>(`/terminal/readers/${encodeURIComponent(args.readerId)}/cancel_action`, {
    method: 'POST',
    accountId,
  })
}

export type CardPresentIntentStatus = {
  id: string
  status: string
  last_payment_error?: { message?: string | null; code?: string | null; decline_code?: string | null } | null
  latest_charge?: {
    id: string
    payment_method_details?: {
      card_present?: { brand?: string | null; last4?: string | null } | null
    } | null
  } | string | null
}

/** The intent with its latest charge expanded (brand + last 4 after approval). */
export async function retrievePaymentIntent(args: {
  tenantId: string
  paymentIntentId: string
}): Promise<CardPresentIntentStatus> {
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<CardPresentIntentStatus>(
    `/payment_intents/${encodeURIComponent(args.paymentIntentId)}?expand[]=latest_charge`,
    { method: 'GET', accountId },
  )
}

/** TEST MODE ONLY: make a simulated reader "tap" a test card. */
export async function simulateReaderTap(args: { tenantId: string; readerId: string }): Promise<StripeReader> {
  if (!stripeTestMode()) throw new Error('stripe_not_test_mode')
  const accountId = await getStripeAccountId(args.tenantId)
  return stripeFetch<StripeReader>(
    `/test_helpers/terminal/readers/${encodeURIComponent(args.readerId)}/present_payment_method`,
    { method: 'POST', accountId },
  )
}
