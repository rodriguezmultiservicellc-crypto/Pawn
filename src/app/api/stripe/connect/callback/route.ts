/**
 * Stripe Connect — return from hosted onboarding.
 *
 * GET /api/stripe/connect/callback
 *
 * Stripe sends the owner here (Account Link return_url) whether or not
 * they finished. The return URL carries no proof of completion, so we
 * re-read the Account from Stripe, persist charges_enabled /
 * payouts_enabled / details_submitted, write an audit row, and send the
 * owner back to Settings → Integrations with ?stripe=connected or
 * ?stripe=incomplete.
 *
 * The `account.updated` webhook keeps the same flags current afterwards
 * (bank verification completing hours later, Stripe disabling charges).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { logAudit } from '@/lib/audit'
import { guardConnectOwner } from '@/lib/stripe/connect-guard'
import {
  loadTenantBilling,
  retrieveAccount,
  syncAccountStatus,
} from '@/lib/stripe/connect'
import {
  buildSettingsRedirect,
  deriveConnectStatus,
  flagForStatus,
} from '@/lib/stripe/connect-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await guardConnectOwner(req.url)
  if (!guard.ok) return guard.response
  const { tenantId, userId, appUrl } = guard

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'misconfigured'))
  }

  let billing
  try {
    billing = await loadTenantBilling(tenantId)
  } catch (err) {
    console.error('[stripe-connect/callback] billing lookup failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'save_failed'))
  }
  const accountId = billing?.stripe_account_id ?? null
  if (!accountId) {
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'not_connected'))
  }

  let account
  try {
    account = await retrieveAccount(accountId)
  } catch (err) {
    console.error('[stripe-connect/callback] account retrieve failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'stripe_error'))
  }

  let patch
  try {
    patch = await syncAccountStatus({
      tenantId,
      account,
      existingConnectedAt: billing?.stripe_connected_at ?? null,
    })
  } catch (err) {
    console.error('[stripe-connect/callback] status save failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'save_failed'))
  }

  const status = deriveConnectStatus({
    stripeAccountId: accountId,
    chargesEnabled: patch.stripe_charges_enabled,
    payoutsEnabled: patch.stripe_payouts_enabled,
    detailsSubmitted: patch.stripe_details_submitted,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'stripe_connect_status_sync',
    tableName: 'tenant_billing_settings',
    recordId: tenantId,
    changes: {
      via: 'onboarding_callback',
      stripe_account_id: accountId,
      status,
      charges_enabled: patch.stripe_charges_enabled,
      payouts_enabled: patch.stripe_payouts_enabled,
      details_submitted: patch.stripe_details_submitted,
      requirements_currently_due: account.requirements?.currently_due ?? [],
      disabled_reason: account.requirements?.disabled_reason ?? null,
    },
  })

  return NextResponse.redirect(
    buildSettingsRedirect(appUrl, flagForStatus(status)),
  )
}
