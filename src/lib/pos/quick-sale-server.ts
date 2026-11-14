import 'server-only'

/**
 * Loads a shop's quick sale buttons with, for product buttons (0082), the
 * available units they sell from — oldest first. Used by the New sale page
 * and Settings → Quick sale buttons, through the caller's own client (RLS).
 */

import type { createClient } from '@/lib/supabase/server'
import { escapeIlikeLiteral } from '@/lib/tenant-resolver'
import { matchKey, type QuickSaleButton, type QuickUnit } from './quick-sale'

type Client = Awaited<ReturnType<typeof createClient>>

export type QuickSaleRecord = QuickSaleButton & { is_active: boolean }

const UNITS_PER_BUTTON = 200

export async function loadQuickSaleButtons(
  supabase: Client,
  tenantId: string,
  opts: { activeOnly: boolean },
): Promise<QuickSaleRecord[]> {
  let q = supabase
    .from('quick_sale_buttons')
    .select('id, name, price, is_active, match_description, match_category')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (opts.activeOnly) q = q.eq('is_active', true)
  const { data: rows } = await q

  return Promise.all(
    (rows ?? []).map(async (r): Promise<QuickSaleRecord> => {
      if (!r.match_description || !r.match_category) {
        return { kind: 'plain', id: r.id, name: r.name, price: Number(r.price), is_active: r.is_active }
      }
      // ilike with no wildcards = case-insensitive equality; the exact
      // trimmed/lowercased comparison happens below.
      const { data: items } = await supabase
        .from('inventory_items')
        .select('id, sku, description, list_price, category')
        .eq('tenant_id', tenantId)
        .eq('category', r.match_category)
        .eq('status', 'available')
        .is('reserved_order_id', null)
        .is('deleted_at', null)
        .ilike('description', escapeIlikeLiteral(r.match_description))
        .order('created_at', { ascending: true })
        .limit(UNITS_PER_BUTTON)
      const units: QuickUnit[] = (items ?? [])
        .filter((i) => matchKey(i.description) === r.match_description)
        .map((i) => ({
          id: i.id,
          sku: i.sku,
          description: i.description,
          list_price: i.list_price == null ? null : Number(i.list_price),
          category: i.category,
        }))
      return { kind: 'product', id: r.id, name: r.name, units, is_active: r.is_active }
    }),
  )
}
