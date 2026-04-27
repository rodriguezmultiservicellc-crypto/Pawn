import { guardReportRequest } from '@/lib/reports/api-guard'
import { getPawnAging, type PawnAgingRow } from '@/lib/reports/pawn-aging'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<PawnAgingRow>> = [
  { header: 'loan_id', value: 'loan_id' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'ticket_number', value: 'ticket_number' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'customer_phone', value: 'customer_phone' },
  { header: 'principal', value: 'principal' },
  { header: 'interest_rate_monthly', value: 'interest_rate_monthly' },
  { header: 'term_days', value: 'term_days' },
  { header: 'issue_date', value: 'issue_date' },
  { header: 'due_date', value: 'due_date' },
  { header: 'status', value: 'status' },
  { header: 'days_to_due', value: 'days_to_due' },
  { header: 'bucket', value: 'bucket' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getPawnAging({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'loans',
    recordId: guarded.tenantId,
    changes: {
      report: 'pawn-aging',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  return csvResponse(
    `pawn-aging-${guarded.range.from}_to_${guarded.range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
