import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadConfiguredSecretKinds } from '@/lib/secrets/vault'
import {
  accountIdSuffix,
  deriveConnectStatus,
  type ConnectRedirectFlag,
} from '@/lib/stripe/connect-status'
import IntegrationsContent, { type IntegrationsView } from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin', 'manager'])

const STRIPE_FLAGS: ReadonlySet<string> = new Set<ConnectRedirectFlag>([
  'connected',
  'incomplete',
  'not_connected',
  'forbidden',
  'misconfigured',
  'stripe_error',
  'save_failed',
])

type SearchParams = Promise<{ stripe?: string }>

/**
 * Integrations index. One card per connectable service with its current
 * connection status. Each card links to its dedicated settings surface.
 *
 * Connection state is read live from:
 *   stripe_connect    -> tenant_billing_settings.stripe_account_id +
 *                        stripe_details_submitted + stripe_charges_enabled
 *                        (deriveConnectStatus; synced by the Connect
 *                        callback + account.updated webhook)
 *   twilio            -> settings.twilio_account_sid +
 *                        vault has 'twilio_auth_token'
 *   resend            -> vault has 'resend_api_key'
 *   ebay              -> vault has 'ebay_refresh_token' +
 *                        !disconnected_at
 *   spot_prices       -> always 'available' (system-wide); per-tenant
 *                        override controls live at /inventory/spot-prices
 */
export default async function IntegrationsPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }

  const params = await props.searchParams
  const stripeFlag =
    params.stripe && STRIPE_FLAGS.has(params.stripe)
      ? (params.stripe as ConnectRedirectFlag)
      : null

  const admin = createAdminClient()

  const [billingRes, settingsRes, ebayRes, tenantRes, googleRevRes, secrets] = await Promise.all([
    admin
      .from('tenant_billing_settings')
      .select(
        'stripe_account_id, stripe_connected_at, stripe_terminal_location_id, billing_enabled, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_status_synced_at',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('settings')
      .select(
        'twilio_account_sid, twilio_sms_from, twilio_whatsapp_from, twilio_messaging_service_sid, resend_from_email, google_place_id',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenant_ebay_credentials')
      .select('disconnected_at, environment, ebay_user_id, connected_at')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenants')
      .select('id, has_retail')
      .eq('id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenant_google_reviews')
      .select('rating, total_review_count, fetched_at, last_error')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    loadConfiguredSecretKinds(ctx.tenantId),
  ])

  const billing = billingRes.data
  const settings = settingsRes.data
  const ebay = ebayRes.data
  const tenant = tenantRes.data
  const googleRev = googleRevRes.data

  if (!tenant) redirect('/no-tenant')

  const view: IntegrationsView = {
    tenantId: ctx.tenantId,
    role: ctx.tenantRole,
    hasRetail: tenant.has_retail,
    stripeConnect: {
      status: deriveConnectStatus({
        stripeAccountId: billing?.stripe_account_id,
        chargesEnabled: billing?.stripe_charges_enabled,
        payoutsEnabled: billing?.stripe_payouts_enabled,
        detailsSubmitted: billing?.stripe_details_submitted,
      }),
      accountIdSuffix: accountIdSuffix(billing?.stripe_account_id),
      connectedAt: billing?.stripe_connected_at ?? null,
      terminalLocationId: billing?.stripe_terminal_location_id ?? null,
      chargesEnabled: billing?.stripe_charges_enabled ?? false,
      payoutsEnabled: billing?.stripe_payouts_enabled ?? false,
      statusSyncedAt: billing?.stripe_status_synced_at ?? null,
      flag: stripeFlag,
    },
    twilio: {
      connected: !!(settings?.twilio_account_sid && secrets.has('twilio_auth_token')),
      accountSid: settings?.twilio_account_sid ?? null,
      smsFrom: settings?.twilio_sms_from ?? null,
      whatsappFrom: settings?.twilio_whatsapp_from ?? null,
      messagingServiceSid: settings?.twilio_messaging_service_sid ?? null,
    },
    resend: {
      connected: secrets.has('resend_api_key'),
      fromEmail: settings?.resend_from_email ?? null,
    },
    ebay: {
      connected: secrets.has('ebay_refresh_token') && !ebay?.disconnected_at,
      ebayUserId: ebay?.ebay_user_id ?? null,
      environment: (ebay?.environment as 'sandbox' | 'production' | null) ?? null,
      connectedAt: ebay?.connected_at ?? null,
      disconnectedAt: ebay?.disconnected_at ?? null,
    },
    googleReviews: {
      configured: !!settings?.google_place_id,
      connected:
        !!settings?.google_place_id && !!googleRev && !googleRev.last_error,
      rating: googleRev?.rating ?? null,
      totalReviewCount: googleRev?.total_review_count ?? null,
      lastError: googleRev?.last_error ?? null,
    },
  }

  return <IntegrationsContent view={view} />
}
