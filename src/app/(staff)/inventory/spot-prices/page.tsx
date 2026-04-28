import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getLatestSpotPrices,
  getSpotPriceHistory,
} from '@/lib/spot-prices/lookup'
import SpotPricesContent, {
  type SpotPriceCard,
  type SpotPriceHistoryPoint,
  type SpotPriceOverrideTuple,
} from './content'
import type {
  MetalPurity,
  MetalType,
  SpotPriceOverrideRow,
} from '@/types/database-aliases'

export const dynamic = 'force-dynamic'

/** Combos surfaced in the grid + override controls. Mirrors the PURITY_MAP
 *  in src/lib/spot-prices/refresh.ts. */
const COMBOS: ReadonlyArray<{ metalType: MetalType; purity: MetalPurity }> = [
  { metalType: 'gold', purity: 'pure_24k' },
  { metalType: 'gold', purity: '22k' },
  { metalType: 'gold', purity: '18k' },
  { metalType: 'gold', purity: '14k' },
  { metalType: 'gold', purity: '10k' },
  { metalType: 'gold', purity: 'fine' },
  { metalType: 'silver', purity: 'fine' },
  { metalType: 'silver', purity: 'sterling_925' },
  { metalType: 'platinum', purity: 'platinum_950' },
  { metalType: 'palladium', purity: 'palladium_950' },
]

export default async function SpotPricesPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Page is gated on has_pawn || has_retail (most shops want it whether
  // they pawn or just buy/sell). Repair-only shops without retail or pawn
  // hide the page entirely.
  const { data: tenantRow } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenantRow || (!tenantRow.has_pawn && !tenantRow.has_retail)) {
    redirect('/inventory')
  }

  const [latestMap, history, overrideRows] = await Promise.all([
    getLatestSpotPrices(COMBOS),
    getSpotPriceHistory({ windowHours: 24 }),
    loadOverrides(ctx.tenantId),
  ])

  const overridesByKey = new Map<string, string>()
  for (const r of overrideRows) {
    overridesByKey.set(`${r.metal_type}::${r.purity}`, r.multiplier)
  }

  const cards: SpotPriceCard[] = COMBOS.map(({ metalType, purity }) => {
    const key = `${metalType}::${purity}`
    const row = latestMap.get(key) ?? null
    return {
      metal_type: metalType,
      purity,
      price_per_gram: row?.price_per_gram ?? null,
      price_per_troy_oz: row?.price_per_troy_oz ?? null,
      currency: row?.currency ?? 'USD',
      source: row?.source ?? null,
      fetched_at: row?.fetched_at ?? null,
      multiplier: overridesByKey.get(key) ?? '1.0000',
    }
  })

  const historyPoints: SpotPriceHistoryPoint[] = history.map((r) => ({
    metal_type: r.metal_type,
    purity: r.purity,
    fetched_at: r.fetched_at,
    price_per_gram: r.price_per_gram,
  }))

  const overrideTuples: SpotPriceOverrideTuple[] = COMBOS.map(
    ({ metalType, purity }) => ({
      metal_type: metalType,
      purity,
      multiplier: overridesByKey.get(`${metalType}::${purity}`) ?? '1.0000',
    }),
  )

  // Owner / manager / chain_admin can hit "Refresh now". Anyone else sees
  // the read-only page.
  const canRefresh =
    ctx.tenantRole === 'owner' ||
    ctx.tenantRole === 'manager' ||
    ctx.tenantRole === 'chain_admin'

  return (
    <SpotPricesContent
      cards={cards}
      history={historyPoints}
      overrides={overrideTuples}
      canRefresh={canRefresh}
    />
  )
}

async function loadOverrides(tenantId: string): Promise<SpotPriceOverrideRow[]> {
  // Use the admin client because the spot_price_overrides RLS policy reads
  // through my_is_staff(tenant_id), and the user-scoped client could be
  // hit by a chain_admin viewing a child shop. Easier to admin-load with
  // an explicit tenant_id filter than fight the RLS join.
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = (admin as any).from('spot_price_overrides')
  const { data, error } = await tbl
    .select(
      'id, tenant_id, metal_type, purity, multiplier, updated_by, updated_at, created_at',
    )
    .eq('tenant_id', tenantId)
  if (error) {
    console.error('[spot-prices] override load failed', error.message)
    return []
  }
  return (data ?? []) as SpotPriceOverrideRow[]
}
