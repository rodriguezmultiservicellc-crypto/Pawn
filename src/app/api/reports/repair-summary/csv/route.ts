import { guardReportRequest } from '@/lib/reports/api-guard'
import { getRepairSummary, type RepairSummaryRow } from '@/lib/reports/repair-summary'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<RepairSummaryRow>> = [
  { header: 'ticket_id', value: 'ticket_id' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'ticket_number', value: 'ticket_number' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'service_type', value: 'service_type' },
  { header: 'status', value: 'status' },
  { header: 'title', value: 'title' },
  { header: 'quote_amount', value: 'quote_amount' },
  { header: 'deposit_amount', value: 'deposit_amount' },
  { header: 'paid_amount', value: 'paid_amount' },
  { header: 'promised_date', value: 'promised_date' },
  { header: 'created_at', value: 'created_at' },
  { header: 'completed_at', value: 'completed_at' },
  { header: 'picked_up_at', value: 'picked_up_at' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getRepairSummary({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'repair_tickets',
    recordId: guarded.tenantId,
    changes: {
      report: 'repair-summary',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  return csvResponse(
    `repair-summary-${guarded.range.from}_to_${guarded.range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
