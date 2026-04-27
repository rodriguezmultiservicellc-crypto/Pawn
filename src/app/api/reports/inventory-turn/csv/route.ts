import { guardReportRequest } from '@/lib/reports/api-guard'
import { getInventoryTurn, type InventoryTurnRow } from '@/lib/reports/inventory-turn'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<InventoryTurnRow>> = [
  { header: 'item_id', value: 'item_id' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'sku', value: 'sku' },
  { header: 'description', value: 'description' },
  { header: 'category', value: 'category' },
  { header: 'source', value: 'source' },
  { header: 'cost_basis', value: 'cost_basis' },
  { header: 'sale_price', value: 'sale_price' },
  { header: 'margin', value: 'margin' },
  { header: 'acquired_at', value: 'acquired_at' },
  { header: 'sold_at', value: 'sold_at' },
  { header: 'days_in_stock', value: 'days_in_stock' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getInventoryTurn({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'inventory_items',
    recordId: guarded.tenantId,
    changes: {
      report: 'inventory-turn',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  return csvResponse(
    `inventory-turn-${guarded.range.from}_to_${guarded.range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
