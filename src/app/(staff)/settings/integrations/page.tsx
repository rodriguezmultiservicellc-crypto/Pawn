import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadConfiguredSecretKinds } from '@/lib/secrets/vault'
import IntegrationsContent, { type IntegrationsView } from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin', 'manager'])

/**
 * Integrations index. One card per connectable service with its current
 * connection status. Each card links to its dedicated settings surface.
 *
 * Connection state is read live from:
 *   stripe_connect    -> tenant_billing_settings.stripe_account_id +
 *                        stripe_connected_at
 *   twilio            -> settings.twilio_account_sid +
 *                        vault has 'twilio_auth_token'
 *   resend            -> vault has 'resend_api_key'
 *   ebay              -> vault has 'ebay_refresh_token' +
 *                        !disconnected_at
 *   spot_prices       -> always 'available' (system-wide); per-tenant
 *                        override controls live at /inventory/spot-prices
 */
export default async function IntegrationsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()

  const [billingRes, settingsRes, ebayRes, tenantRes, googleRevRes, secrets] = await Promise.all([
    admin
      .from('tenant_billing_settings')
      .select(
        'stripe_account_id, stripe_connected_at, stripe_terminal_location_id, billing_enabled',
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
      connected: !!(billing?.stripe_account_id && billing.stripe_connected_at),
      stripeAccountId: billing?.stripe_account_id ?? null,
      connectedAt: billing?.stripe_connected_at ?? null,
      terminalLocationId: billing?.stripe_terminal_location_id ?? null,
      billingEnabled: billing?.billing_enabled ?? false,
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
