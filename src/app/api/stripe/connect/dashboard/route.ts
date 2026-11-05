/**
 * Stripe Connect — open the tenant's Express dashboard.
 *
 * GET /api/stripe/connect/dashboard
 *
 * Owner-only. Mints a single-use Login Link for the tenant's Express
 * account and redirects into it (payouts, balance, disputes live there).
 * Login links only exist for Express accounts; if the tenant has not
 * finished onboarding we send them back into the onboarding flow instead.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { guardConnectOwner } from '@/lib/stripe/connect-guard'
import { createLoginLink, loadTenantBilling } from '@/lib/stripe/connect'
import {
  buildSettingsRedirect,
  CONNECT_PATHS,
  deriveConnectStatus,
  normalizeAppUrl,
} from '@/lib/stripe/connect-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await guardConnectOwner(req.url)
  if (!guard.ok) return guard.response
  const { tenantId, appUrl } = guard

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'misconfigured'))
  }

  let billing
  try {
    billing = await loadTenantBilling(tenantId)
  } catch (err) {
    console.error('[stripe-connect/dashboard] billing lookup failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'save_failed'))
  }

  const status = deriveConnectStatus({
    stripeAccountId: billing?.stripe_account_id,
    chargesEnabled: billing?.stripe_charges_enabled,
    payoutsEnabled: billing?.stripe_payouts_enabled,
    detailsSubmitted: billing?.stripe_details_submitted,
  })
  if (status === 'not_connected') {
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'not_connected'))
  }
  if (status === 'onboarding_incomplete') {
    return NextResponse.redirect(
      `${normalizeAppUrl(appUrl)}${CONNECT_PATHS.start}`,
    )
  }

  try {
    const link = await createLoginLink(billing!.stripe_account_id!)
    return NextResponse.redirect(link.url)
  } catch (err) {
    console.error('[stripe-connect/dashboard] login link failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'stripe_error'))
  }
}
