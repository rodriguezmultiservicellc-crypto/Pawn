/**
 * Stripe Connect — per-tenant onboarding (server-side).
 *
 * MODEL:
 *   One Stripe **Express** connected account per tenant, created by the
 *   platform (RMS) with the platform STRIPE_SECRET_KEY and stamped with
 *   metadata.tenant_id. The owner completes Stripe-hosted onboarding via
 *   an Account Link; afterwards both surfaces (Terminal in
 *   ./terminal.ts, Checkout in ./payment-link.ts) act on the account via
 *   the Stripe-Account header. Express gives us login links ("Open Stripe
 *   dashboard") which Standard accounts do not have.
 *
 * STATE:
 *   tenant_billing_settings.stripe_account_id        — set once at creation
 *   tenant_billing_settings.stripe_{charges_enabled,
 *     payouts_enabled, details_submitted}             — synced (patches/0069)
 *   tenant_billing_settings.billing_enabled           — mirrors charges_enabled
 *   tenant_billing_settings.stripe_connected_at       — first time connected
 *
 *   Sync points: /api/stripe/connect/callback (return_url) and the
 *   `account.updated` event on /api/stripe/webhook.
 *
 * ENV VARS REQUIRED:
 *   STRIPE_SECRET_KEY    — platform secret key
 *   NEXT_PUBLIC_APP_URL  — return / refresh URLs for the Account Link
 *
 * RUNTIME:
 *   Server-only. Route handlers guard tenant + role BEFORE calling these.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeFetch, type StripeFormBody } from './http'
import {
  billingPatchFromAccount,
  buildAccountLinkUrls,
  type StripeAccountFlags,
} from './connect-status'

// ── Types ────────────────────────────────────────────────────────────────

export type StripeAccount = StripeAccountFlags & {
  object: 'account'
  type?: 'express' | 'standard' | 'custom' | string
  email?: string | null
  metadata?: Record<string, string> | null
  requirements?: {
    currently_due?: string[]
    disabled_reason?: string | null
  } | null
}

export type StripeAccountLink = {
  object: 'account_link'
  url: string
  expires_at: number
}

export type StripeLoginLink = {
  object: 'login_link'
  url: string
}

export type TenantBillingRow = {
  tenant_id: string
  stripe_account_id: string | null
  stripe_connected_at: string | null
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  stripe_details_submitted: boolean
  billing_enabled: boolean
}

// ── Stripe calls ─────────────────────────────────────────────────────────

/**
 * Create the Express account for a tenant. Idempotent on tenant id so a
 * double-click on "Connect" cannot create two accounts.
 */
export async function createExpressAccount(args: {
  tenantId: string
  businessName: string
  email?: string | null
  country?: string
}): Promise<StripeAccount> {
  const body: StripeFormBody = {
    type: 'express',
    country: (args.country ?? 'US').toUpperCase(),
    'capabilities[card_payments][requested]': true,
    'capabilities[transfers][requested]': true,
    'business_profile[name]': args.businessName,
    'metadata[tenant_id]': args.tenantId,
    'metadata[app]': 'sol_pawn',
  }
  if (args.email) body.email = args.email
  return stripeFetch<StripeAccount>('/accounts', {
    method: 'POST',
    body,
    idempotencyKey: `pawn_connect_account_${args.tenantId}`,
  })
}

/** Mint a fresh hosted-onboarding link (single use, ~5 min TTL). */
export async function createAccountLink(args: {
  accountId: string
  appUrl: string | undefined
}): Promise<StripeAccountLink> {
  const { returnUrl, refreshUrl } = buildAccountLinkUrls(args.appUrl)
  return stripeFetch<StripeAccountLink>('/account_links', {
    method: 'POST',
    body: {
      account: args.accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    },
  })
}

export async function retrieveAccount(
  accountId: string,
): Promise<StripeAccount> {
  return stripeFetch<StripeAccount>(
    `/accounts/${encodeURIComponent(accountId)}`,
    { method: 'GET' },
  )
}

/** Express-only: one-time URL into the account's Stripe dashboard. */
export async function createLoginLink(
  accountId: string,
): Promise<StripeLoginLink> {
  return stripeFetch<StripeLoginLink>(
    `/accounts/${encodeURIComponent(accountId)}/login_links`,
    { method: 'POST' },
  )
}

// ── DB ───────────────────────────────────────────────────────────────────

export async function loadTenantBilling(
  tenantId: string,
): Promise<TenantBillingRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tenant_billing_settings')
    .select(
      'tenant_id, stripe_account_id, stripe_connected_at, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, billing_enabled',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`tenant_billing_lookup_failed: ${error.message}`)
  return (data as TenantBillingRow | null) ?? null
}

/** Resolve the tenant that owns a connected account (webhook routing). */
export async function findTenantByStripeAccountId(
  accountId: string,
): Promise<TenantBillingRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tenant_billing_settings')
    .select(
      'tenant_id, stripe_account_id, stripe_connected_at, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, billing_enabled',
    )
    .eq('stripe_account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`tenant_billing_lookup_failed: ${error.message}`)
  return (data as TenantBillingRow | null) ?? null
}

/**
 * Persist the account id right after creation. Upsert because a tenant
 * provisioned before 0001's RPC inserted the billing row could lack one.
 */
export async function saveStripeAccountId(args: {
  tenantId: string
  accountId: string
}): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('tenant_billing_settings')
    .upsert(
      { tenant_id: args.tenantId, stripe_account_id: args.accountId },
      { onConflict: 'tenant_id' },
    )
  if (error) throw new Error(`stripe_account_save_failed: ${error.message}`)
}

/**
 * Write the three status flags (+ billing_enabled, + first connected_at)
 * from a freshly-read Stripe account. Returns the patch that was written
 * so callers can audit it.
 */
export async function syncAccountStatus(args: {
  tenantId: string
  account: StripeAccountFlags
  existingConnectedAt: string | null
  now?: Date
}) {
  const patch = billingPatchFromAccount(args.account, {
    now: args.now ?? new Date(),
    existingConnectedAt: args.existingConnectedAt,
  })
  const admin = createAdminClient()
  const { error } = await admin
    .from('tenant_billing_settings')
    .update(patch)
    .eq('tenant_id', args.tenantId)
  if (error) throw new Error(`stripe_status_save_failed: ${error.message}`)
  return patch
}
