import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSpotFreshness } from '@/lib/spot-prices/lookup'
import { canConfirmStaleSpot } from '@/lib/spot-prices/stale-gate'
import { loadRateMaps } from '@/lib/metal-counter/rates'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import BuyForm from './form'

/**
 * Buy-outright (gold-buying) intake page — the BUY side of the metal
 * counter (brief Phase 3; the SELL side is /buy/sell).
 *
 * Module gate: has_pawn (FL pawn license is what authorizes outright
 * jewelry purchases from the public).
 *
 * Role gate: owner / manager / pawn_clerk / chain_admin — same set as
 * pawn intake.
 *
 * Server-side preload: latest spot price per (metal, purity) + tenant
 * pay-rate multipliers (lib/metal-counter/rates) + the effective buy hold.
 * The form does the live two-way grams ⇄ dollars math client-side from
 * those values so each keystroke doesn't round-trip the server.
 */
export default async function NewBuyPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const admin = createAdminClient()

  const [rates, rules, scSettings, spotFreshness] = await Promise.all([
    loadRateMaps(ctx.tenantId),
    loadTenantRules(admin, ctx.tenantId),
    admin
      .from('settings')
      .select('store_credit_enabled')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
    getSpotFreshness(),
  ])

  return (
    <BuyForm
      rates={rates}
      // GREATEST(tenant setting, statutory hold) — patches/0048.
      buyHoldDays={rules.buyHoldDays}
      storeCreditEnabled={scSettings?.data?.store_credit_enabled === true}
      spotFreshness={spotFreshness}
      canConfirmStale={canConfirmStaleSpot(ctx.tenantRole)}
    />
  )
}
