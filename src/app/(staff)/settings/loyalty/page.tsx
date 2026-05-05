import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import LoyaltySettingsContent from './content'

const SETTINGS_ROLES = new Set(['owner', 'chain_admin'])

export default async function LoyaltySettingsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !SETTINGS_ROLES.has(ctx.tenantRole)) {
    redirect('/settings')
  }

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('settings')
    .select(
      'loyalty_enabled, loyalty_earn_rate_retail, loyalty_earn_rate_loan_interest, loyalty_redemption_rate, loyalty_referral_bonus',
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!settings) redirect('/settings')

  return (
    <LoyaltySettingsContent
      initial={{
        loyalty_enabled: !!settings.loyalty_enabled,
        loyalty_earn_rate_retail: Number(settings.loyalty_earn_rate_retail),
        loyalty_earn_rate_loan_interest: Number(settings.loyalty_earn_rate_loan_interest),
        loyalty_redemption_rate: Number(settings.loyalty_redemption_rate),
        loyalty_referral_bonus: settings.loyalty_referral_bonus,
      }}
    />
  )
}
