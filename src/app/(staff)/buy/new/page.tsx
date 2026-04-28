import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getLatestSpotPrices,
} from '@/lib/spot-prices/lookup'
import type {
  MetalPurity,
  MetalType,
  SpotPriceOverrideRow,
} from '@/types/database-aliases'
import BuyForm, { type SpotPriceMap, type OverrideMap } from './form'

const PURITY_COMBOS: ReadonlyArray<{ metalType: MetalType; purity: MetalPurity }> = [
  { metalType: 'gold', purity: 'pure_24k' },
  { metalType: 'gold', purity: '22k' },
  { metalType: 'gold', purity: '18k' },
  { metalType: 'gold', purity: '14k' },
  { metalType: 'gold', purity: '10k' },
  { metalType: 'silver', purity: 'sterling_925' },
  { metalType: 'silver', purity: 'fine' },
  { metalType: 'platinum', purity: 'platinum_950' },
  { metalType: 'palladium', purity: 'palladium_950' },
]

/**
 * Buy-outright (gold-buying) intake page.
 *
 * Module gate: has_pawn (FL pawn license is what authorizes outright
 * jewelry purchases from the public).
 *
 * Role gate: owner / manager / pawn_clerk / chain_admin — same set as
 * pawn intake.
 *
 * Server-side preload: latest spot price per (metal, purity) + tenant
 * pay-rate override multipliers + buy_hold_period_days. The form does
 * the live melt math client-side using those values so each keystroke
 * doesn't round-trip the server.
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

  const [spotMap, overridesRes, settingsRes] = await Promise.all([
    getLatestSpotPrices(PURITY_COMBOS),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from('spot_price_overrides')
      .select('metal_type, purity, multiplier')
      .eq('tenant_id', ctx.tenantId),
    admin
      .from('settings')
      .select('buy_hold_period_days')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
  ])

  // Flatten the spot map into a plain Record<key, perGram> the client
  // can use without server-only types.
  const spotPriceMap: SpotPriceMap = {}
  for (const [key, row] of spotMap.entries()) {
    if (row?.price_per_gram != null) {
      const n = Number(row.price_per_gram)
      if (Number.isFinite(n)) spotPriceMap[key] = n
    }
  }

  // Tenant override multipliers keyed by metal::purity.
  const overrideMap: OverrideMap = {}
  const overrideRows = (overridesRes?.data ?? []) as Array<
    Pick<SpotPriceOverrideRow, 'metal_type' | 'purity' | 'multiplier'>
  >
  for (const r of overrideRows) {
    const m = Number(r.multiplier)
    if (Number.isFinite(m)) {
      overrideMap[`${r.metal_type}::${r.purity}`] = m
    }
  }

  const buyHoldDays =
    settingsRes.data?.buy_hold_period_days != null &&
    settingsRes.data.buy_hold_period_days >= 0
      ? settingsRes.data.buy_hold_period_days
      : 30

  return (
    <BuyForm
      spotPriceMap={spotPriceMap}
      overrideMap={overrideMap}
      buyHoldDays={buyHoldDays}
    />
  )
}
