import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadConfiguredSecretKinds } from '@/lib/secrets/vault'
import SettingsContent, { type SettingsHubView } from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin', 'manager'])

/**
 * Settings landing page. Hub of links to each settings subsection,
 * each annotated with a "configured / needs setup" status read from
 * the live tenant rows so a new operator can see at a glance what's
 * left to wire up.
 *
 * Role gate: owner / chain_admin / manager. Tenant-side billing UI
 * lives at /billing (owner / chain_admin only) — exposed here as a
 * separate card.
 */
export default async function SettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()

  const [tenantRes, settingsRes, billingRes, ebayRes, subRes, secrets] = await Promise.all([
    admin
      .from('tenants')
      .select(
        'id, name, dba, address, city, state, zip, phone, email, has_pawn, has_repair, has_retail, tenant_type, parent_tenant_id',
      )
      .eq('id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('settings')
      .select(
        'twilio_account_sid, default_loan_interest_rate, default_loan_term_days, abandoned_repair_days, buy_hold_period_days',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenant_billing_settings')
      .select('stripe_account_id, stripe_connected_at, billing_enabled')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenant_ebay_credentials')
      .select('disconnected_at, environment')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    admin
      .from('tenant_subscriptions')
      .select(
        'plan_id, status, billing_cycle, trial_ends_at, current_period_end',
      )
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    loadConfiguredSecretKinds(ctx.tenantId),
  ])

  const tenant = tenantRes.data
  const settings = settingsRes.data
  const billing = billingRes.data
  const ebay = ebayRes.data
  const sub = subRes.data

  if (!tenant) redirect('/no-tenant')

  // Roll up plan name when subscription exists.
  let planName: string | null = null
  if (sub?.plan_id) {
    const { data: plan } = await admin
      .from('subscription_plans')
      .select('name')
      .eq('id', sub.plan_id)
      .maybeSingle()
    planName = plan?.name ?? null
  }

  const view: SettingsHubView = {
    tenantId: tenant.id,
    tenantName: tenant.dba ?? tenant.name,
    tenantType: tenant.tenant_type,
    parentTenantId: tenant.parent_tenant_id,
    addressFilled: !!(tenant.address && tenant.city && tenant.state && tenant.zip),
    contactFilled: !!(tenant.phone || tenant.email),
    modules: {
      pawn: tenant.has_pawn,
      repair: tenant.has_repair,
      retail: tenant.has_retail,
    },
    role: ctx.tenantRole,
    integrations: {
      stripeConnect: {
        connected: !!(billing?.stripe_account_id && billing.stripe_connected_at),
        billingEnabled: billing?.billing_enabled ?? false,
      },
      twilio: { connected: !!(settings?.twilio_account_sid && secrets.has('twilio_auth_token')) },
      resend: { connected: secrets.has('resend_api_key') },
      ebay: {
        connected: secrets.has('ebay_refresh_token') && !ebay?.disconnected_at,
        environment: (ebay?.environment as 'sandbox' | 'production' | null) ?? null,
      },
    },
    subscription: sub
      ? {
          planName,
          status: sub.status,
          cycle: sub.billing_cycle,
          trialEndsAt: sub.trial_ends_at,
          periodEndsAt: sub.current_period_end,
        }
      : null,
    pawnDefaults: settings
      ? {
          interestRateMonthly: Number(settings.default_loan_interest_rate ?? 0),
          termDays: settings.default_loan_term_days ?? 0,
          abandonedRepairDays: settings.abandoned_repair_days ?? 0,
          buyHoldPeriodDays: settings.buy_hold_period_days ?? 0,
        }
      : null,
  }

  return <SettingsContent view={view} />
}
