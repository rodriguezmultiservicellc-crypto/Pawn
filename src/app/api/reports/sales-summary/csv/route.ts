import { guardReportRequest } from '@/lib/reports/api-guard'
import { getSalesSummary, type SalesSummaryRow } from '@/lib/reports/sales-summary'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<SalesSummaryRow>> = [
  { header: 'sale_id', value: 'sale_id' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'sale_number', value: 'sale_number' },
  { header: 'sale_kind', value: 'sale_kind' },
  { header: 'status', value: 'status' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'subtotal', value: 'subtotal' },
  { header: 'tax_amount', value: 'tax_amount' },
  { header: 'discount_amount', value: 'discount_amount' },
  { header: 'total', value: 'total' },
  { header: 'paid_total', value: 'paid_total' },
  { header: 'returned_total', value: 'returned_total' },
  { header: 'net', value: 'net' },
  { header: 'completed_at', value: 'completed_at' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getSalesSummary({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'sales',
    recordId: guarded.tenantId,
    changes: {
      report: 'sales-summary',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  return csvResponse(
    `sales-summary-${guarded.range.from}_to_${guarded.range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
