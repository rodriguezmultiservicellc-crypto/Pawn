/**
 * Inventory items a repair part can be taken from: this shop's AVAILABLE
 * stock (patches/0130 moves a used one out), newest SKU first, capped at
 * 200. Shared by the ticket page and My jobs. Server only; the caller has
 * resolved the tenant and checked the role.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { InventoryPartOption } from '@/components/repair/AddPartDialog'

export const PART_PICKER_MAX = 200

export async function loadPartPickerOptions(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<InventoryPartOption[]> {
  const { data } = await supabase
    .from('inventory_items')
    .select('id, sku, description, cost_basis, category')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .eq('status', 'available')
    .order('sku', { ascending: false })
    .limit(PART_PICKER_MAX)
  return (data ?? []).map((i) => ({
    id: i.id,
    label: `${i.sku} — ${i.description}`,
    cost_basis: i.cost_basis == null ? null : Number(i.cost_basis),
    category: i.category,
  }))
}
