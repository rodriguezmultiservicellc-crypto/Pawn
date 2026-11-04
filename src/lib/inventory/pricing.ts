import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const DEFAULT_INVENTORY_TARGET_MARGIN = 0.5

/**
 * settings.inventory_target_margin_pct (patches/0067) as a fraction. The
 * "Suggest price" button on an inventory item prices cost_basis at this
 * margin: price = cost / (1 − margin) — same formula the custom quoter
 * uses (lib/custom-quotes/math priceFromCost).
 */
export async function loadInventoryTargetMargin(
  client: SupabaseClient<Database>,
  tenantId: string,
): Promise<number> {
  const { data } = await client
    .from('settings')
    .select('inventory_target_margin_pct')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const n = Number(data?.inventory_target_margin_pct)
  return Number.isFinite(n) ? n : DEFAULT_INVENTORY_TARGET_MARGIN
}
