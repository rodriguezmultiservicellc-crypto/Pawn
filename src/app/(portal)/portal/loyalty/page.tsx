// src/app/(portal)/portal/loyalty/page.tsx
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureReferralCode } from '@/lib/loyalty/events'
import { buildPublicLandingUrl } from '@/lib/loyalty/url'
import LoyaltyPortalContent from './content'

export default async function PortalLoyaltyPage() {
  const ctx = await getCtx()
  if (!ctx || !ctx.tenantId) notFound()

  const admin = createAdminClient()

  const { data: settings } = await admin
    .from('settings')
    .select(
      'loyalty_enabled, loyalty_earn_rate_retail, loyalty_earn_rate_loan_interest, loyalty_redemption_rate, loyalty_referral_bonus',
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!settings?.loyalty_enabled) notFound()

  // Resolve the auth user → customer record at this tenant.
  const { data: customer } = await admin
    .from('customers')
    .select(
      'id, first_name, loyalty_points_balance, referral_code, tenant_id',
    )
    .eq('auth_user_id', ctx.userId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!customer) notFound()

  // Lazy-generate referral code.
  const referralCode = customer.referral_code
    ? customer.referral_code
    : await ensureReferralCode(admin, customer.id)

  const { data: tenant } = await admin
    .from('tenants')
    .select('dba, name, public_slug')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  const tenantDba = tenant?.dba ?? tenant?.name ?? ''

  // Build share URL using the existing landing-URL pattern.
  const h = await headers()
  const hostHeader = h.get('host') ?? ''
  const protoHeader =
    h.get('x-forwarded-proto') ?? (hostHeader.startsWith('localhost') ? 'http' : 'https')
  const inferredAppUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `${protoHeader}://${hostHeader}`

  const shareUrl = buildPublicLandingUrl({
    slug: tenant?.public_slug ?? null,
    baseDomain: process.env.NEXT_PUBLIC_BASE_DOMAIN ?? null,
    appUrl: inferredAppUrl,
  })

  // Recent activity (last 20).
  const { data: activity } = await admin
    .from('loyalty_events')
    .select('id, kind, points_delta, reason, created_at')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Referrals issued by this customer.
  const { count: friendsReferred } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by_customer_id', customer.id)

  return (
    <LoyaltyPortalContent
      customer={{
        firstName: customer.first_name ?? '',
        balance: customer.loyalty_points_balance ?? 0,
        referralCode,
      }}
      tenantDba={tenantDba}
      shareUrl={shareUrl ?? ''}
      settings={{
        earnRetail: Number(settings.loyalty_earn_rate_retail),
        earnLoan: Number(settings.loyalty_earn_rate_loan_interest),
        redemptionRate: Number(settings.loyalty_redemption_rate),
        referralBonus: settings.loyalty_referral_bonus,
      }}
      activity={(activity ?? []).map((e) => ({
        id: e.id,
        kind: e.kind as 'earn_sale' | 'earn_loan_interest' | 'earn_referral_bonus' | 'redeem_pos' | 'redeem_undo' | 'earn_clawback' | 'adjust_manual',
        points_delta: e.points_delta,
        reason: e.reason,
        created_at: e.created_at,
      }))}
      friendsReferred={friendsReferred ?? 0}
    />
  )
}
