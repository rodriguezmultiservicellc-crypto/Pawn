import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { getSpotFreshness } from '@/lib/spot-prices/lookup'
import { canConfirmStaleSpot } from '@/lib/spot-prices/stale-gate'
import { loadRateMaps } from '@/lib/metal-counter/rates'
import { PRECIOUS_METALS } from '@/lib/spot-prices/purity'
import SellMetalForm, { type MetalPickRow } from './form'

/**
 * Sell metal — the SELL side of the metal counter (brief Phase 3).
 *
 * Module gate: has_pawn OR has_retail. Selling shop-owned scrap / bullion
 * is a sale, so a retail-only shop gets it too; a repair-only shop does
 * not.
 *
 * Role gate: owner / manager / pawn_clerk / chain_admin (same as the buy
 * side and the POS).
 *
 * The open register session is looked up here only to TELL the operator
 * whether the sale will land on a register close — the action attaches
 * it (or not) again at submit time.
 */
export default async function SellMetalPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant || (!tenant.has_pawn && !tenant.has_retail)) redirect('/dashboard')

  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
  ])

  const [rates, spotFreshness, openSessionRes, itemsRes] = await Promise.all([
    loadRateMaps(ctx.tenantId),
    getSpotFreshness(),
    ctx.supabase
      .from('register_sessions')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .maybeSingle(),
    // Available precious-metal stock the operator can pull onto a line —
    // the lot going to the refiner is usually forfeits + buys already in
    // the safe. Status flips to 'sold' when the sale posts.
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, list_price, category, metal, karat, weight_grams')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'available')
      .in('metal', [...PRECIOUS_METALS])
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const inventory: MetalPickRow[] = (itemsRes.data ?? []).map((i) => ({
    id: i.id,
    sku: i.sku,
    description: i.description,
    list_price: i.list_price == null ? null : Number(i.list_price),
    category: i.category,
    metal: i.metal,
    karat: i.karat,
    weight_grams: i.weight_grams == null ? null : Number(i.weight_grams),
  }))

  return (
    <SellMetalForm
      rates={rates}
      inventory={inventory}
      registerOpen={!!openSessionRes.data}
      showBuyTab={!!tenant.has_pawn}
      spotFreshness={spotFreshness}
      canConfirmStale={canConfirmStaleSpot(ctx.tenantRole)}
    />
  )
}
