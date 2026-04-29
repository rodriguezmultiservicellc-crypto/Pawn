'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff, requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  refreshSpotPrices,
  type RefreshSummary,
} from '@/lib/spot-prices/refresh'
import {
  clearSpotPriceCache,
} from '@/lib/spot-prices/lookup'
import { clearMeltOverrideCache } from '@/lib/spot-prices/melt'
import { toMoney } from '@/lib/pawn/math'
import type {
  MetalPurity,
  MetalType,
  SpotPriceOverrideInsert,
} from '@/types/database-aliases'

export type SaveOverrideState = {
  ok?: boolean
  error?: string
}

const VALID_METALS: ReadonlyArray<MetalType> = [
  'gold',
  'silver',
  'platinum',
  'palladium',
]

const VALID_PURITIES: ReadonlyArray<MetalPurity> = [
  'pure_24k',
  '22k',
  '18k',
  '14k',
  '10k',
  'sterling_925',
  'platinum_950',
  'palladium_950',
  'fine',
]

/**
 * Save a per-tenant pay-rate override for one (metal, purity) combo.
 * Multiplier is parsed as a percentage from the form (UI displays
 * "85" / "100"); we divide by 100 before storage.
 */
export async function saveSpotOverrideAction(
  _prev: SaveOverrideState,
  formData: FormData,
): Promise<SaveOverrideState> {
  const ctx = await getCtx()
  if (!ctx) return { error: 'Not signed in.' }
  if (!ctx.tenantId) return { error: 'No active tenant.' }

  await requireStaff(ctx.tenantId)

  const metalType = String(formData.get('metal_type') ?? '') as MetalType
  const purity = String(formData.get('purity') ?? '') as MetalPurity
  const pctRaw = String(formData.get('multiplier_pct') ?? '').trim()

  if (!VALID_METALS.includes(metalType)) {
    return { error: 'Invalid metal type.' }
  }
  if (!VALID_PURITIES.includes(purity)) {
    return { error: 'Invalid purity.' }
  }
  const pct = parseFloat(pctRaw)
  if (!isFinite(pct) || pct < 0 || pct > 200) {
    return { error: 'Multiplier must be between 0 and 200%.' }
  }
  const multiplier = toMoney(pct / 100)

  const admin = createAdminClient()
  const insert: SpotPriceOverrideInsert = {
    tenant_id: ctx.tenantId,
    metal_type: metalType,
    purity,
    multiplier: String(multiplier),
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  }

  // multiplier is NUMERIC — generated Insert type narrows to string,
  // but supabase-js round-trips number fine. Cast at the upsert boundary.
  const { error } = await admin
    .from('spot_price_overrides')
    .upsert([insert] as never, {
      onConflict: 'tenant_id,metal_type,purity',
    })

  if (error) {
    console.error('[spot-prices] override save failed', error.message)
    return { error: error.message }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'spot_price_override_change',
    tableName: 'spot_price_overrides',
    recordId: ctx.tenantId, // no single row id pre-upsert; use tenant scope
    changes: {
      metal_type: metalType,
      purity,
      multiplier: String(multiplier),
    },
  })

  // Bust the in-process override cache so the next melt computation sees
  // the new multiplier without waiting for the 5-min TTL.
  clearMeltOverrideCache()

  revalidatePath('/inventory/spot-prices')
  revalidatePath('/inventory')
  return { ok: true }
}

export type RefreshNowState = {
  summary?: RefreshSummary
  error?: string
}

/**
 * Manual "Refresh now" — owner / manager / chain_admin only.
 */
export async function refreshSpotPricesAction(
  _prev: RefreshNowState,
  _formData: FormData,
): Promise<RefreshNowState> {
  const ctx = await getCtx()
  if (!ctx) return { error: 'Not signed in.' }
  if (!ctx.tenantId) return { error: 'No active tenant.' }

  await requireRoleInTenant(ctx.tenantId, ['owner', 'manager', 'chain_admin'])

  const summary = await refreshSpotPrices()
  clearSpotPriceCache()

  // Audit-log against the tenant that triggered the refresh (operator
  // attribution). The cron-route version logs against tenant_id NULL.
  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'spot_price_refresh',
    tableName: 'spot_prices',
    recordId: ctx.tenantId,
    changes: {
      ok: summary.ok,
      source: summary.source,
      quotes: summary.quotes,
      attempted: summary.attempted,
      inserted: summary.inserted,
      error: summary.error ?? null,
    },
  })

  revalidatePath('/inventory/spot-prices')
  revalidatePath('/inventory')
  return summary.ok ? { summary } : { summary, error: summary.error ?? 'Refresh failed.' }
}
