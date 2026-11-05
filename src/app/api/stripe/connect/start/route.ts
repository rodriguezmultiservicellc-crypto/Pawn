/**
 * Stripe Connect — start / continue onboarding.
 *
 * GET /api/stripe/connect/start
 *
 * Owner-only. Creates the tenant's Express connected account on first use
 * (persisting stripe_account_id), or reuses the existing one, then mints
 * an Account Link and redirects the owner into Stripe-hosted onboarding.
 * Stripe returns them to /api/stripe/connect/callback; an expired link
 * sends them back here (refresh_url) for a fresh one.
 *
 * On error: redirects to /settings/integrations?stripe=<reason>.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { guardConnectOwner } from '@/lib/stripe/connect-guard'
import {
  createAccountLink,
  createExpressAccount,
  loadTenantBilling,
  saveStripeAccountId,
} from '@/lib/stripe/connect'
import { buildSettingsRedirect } from '@/lib/stripe/connect-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await guardConnectOwner(req.url)
  if (!guard.ok) return guard.response
  const { tenantId, userId, appUrl } = guard

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'misconfigured'))
  }

  let accountId: string | null
  try {
    const billing = await loadTenantBilling(tenantId)
    accountId = billing?.stripe_account_id ?? null
  } catch (err) {
    console.error('[stripe-connect/start] billing lookup failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'save_failed'))
  }

  if (!accountId) {
    const admin = createAdminClient()
    const { data: tenant } = await admin
      .from('tenants')
      .select('name, dba, email')
      .eq('id', tenantId)
      .maybeSingle()

    try {
      const account = await createExpressAccount({
        tenantId,
        businessName: tenant?.dba ?? tenant?.name ?? 'Sol Pawn shop',
        email: tenant?.email ?? null,
      })
      accountId = account.id
    } catch (err) {
      console.error('[stripe-connect/start] account create failed', err)
      return NextResponse.redirect(buildSettingsRedirect(appUrl, 'stripe_error'))
    }

    try {
      await saveStripeAccountId({ tenantId, accountId })
    } catch (err) {
      // The account now exists on Stripe but we could not record it. The
      // idempotency key on createExpressAccount means a retry returns the
      // same account rather than minting a second one.
      console.error('[stripe-connect/start] account id save failed', err)
      return NextResponse.redirect(buildSettingsRedirect(appUrl, 'save_failed'))
    }

    await logAudit({
      tenantId,
      userId,
      action: 'stripe_connect_account_create',
      tableName: 'tenant_billing_settings',
      recordId: tenantId,
      changes: { stripe_account_id: accountId, account_type: 'express' },
    })
  }

  try {
    const link = await createAccountLink({ accountId, appUrl })
    return NextResponse.redirect(link.url)
  } catch (err) {
    console.error('[stripe-connect/start] account link failed', err)
    return NextResponse.redirect(buildSettingsRedirect(appUrl, 'stripe_error'))
  }
}
