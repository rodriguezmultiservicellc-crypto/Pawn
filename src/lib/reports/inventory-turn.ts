/**
 * Inventory turn report — days from acquisition to sale, by source.
 *
 * Source: inventory_items. Sold rows (status='sold' with sold_at set) in
 * the date range. We expose per-row days_in_stock + per-source aggregates
 * (count, average days, gross margin).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { InventorySource } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export type InventoryTurnRow = {
  item_id: string
  tenant_id: string
  sku: string
  description: string
  category: string
  source: InventorySource
  cost_basis: number
  sale_price: number
  margin: number
  acquired_at: string
  sold_at: string
  days_in_stock: number
}

export async function getInventoryTurn(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<ReportResult<InventoryTurnRow>> {
  const { supabase, tenantIds, range } = args
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`

  const { data, error } = await supabase
    .from('inventory_items')
    .select(
      'id, tenant_id, sku, description, category, source, cost_basis, sale_price, acquired_at, sold_at, status',
    )
    .in('tenant_id', tenantIds as string[])
    .is('deleted_at', null)
    .eq('status', 'sold')
    .gte('sold_at', fromIso)
    .lt('sold_at', toExclusiveIso)
    .order('sold_at', { ascending: false })

  if (error) throw new Error(`inventory_turn_query_failed: ${error.message}`)

  const rows: InventoryTurnRow[] = (data ?? []).map((i) => {
    const acqMs = i.acquired_at
      ? Date.UTC(
          Number(i.acquired_at.slice(0, 4)),
          Number(i.acquired_at.slice(5, 7)) - 1,
          Number(i.acquired_at.slice(8, 10)),
        )
      : 0
    const soldMs = i.sold_at ? new Date(i.sold_at).getTime() : 0
    const days = acqMs && soldMs ? Math.round((soldMs - acqMs) / 86400000) : 0
    const cost = Number(i.cost_basis ?? 0)
    const sale = Number(i.sale_price ?? 0)
    return {
      item_id: i.id,
      tenant_id: i.tenant_id,
      sku: i.sku,
      description: i.description,
      category: i.category,
      source: i.source as InventorySource,
      cost_basis: cost,
      sale_price: sale,
      margin: sale - cost,
      acquired_at: i.acquired_at ?? '',
      sold_at: i.sold_at ?? '',
      days_in_stock: days,
    }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.units += 1
      acc.gross_revenue += r.sale_price
      acc.gross_margin += r.margin
      acc.total_days += r.days_in_stock
      return acc
    },
    { units: 0, gross_revenue: 0, gross_margin: 0, total_days: 0 } as Record<
      string,
      number
    >,
  )
  totals.avg_days_in_stock = totals.units > 0 ? totals.total_days / totals.units : 0

  return { rows, totals, tenantIds: [...tenantIds] }
}
