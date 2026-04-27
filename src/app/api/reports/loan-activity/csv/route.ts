import { guardReportRequest } from '@/lib/reports/api-guard'
import { getLoanActivity, type LoanActivityRow } from '@/lib/reports/loan-activity'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<LoanActivityRow>> = [
  { header: 'event_id', value: 'event_id' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'loan_id', value: 'loan_id' },
  { header: 'ticket_number', value: 'ticket_number' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'event_type', value: 'event_type' },
  { header: 'amount', value: 'amount' },
  { header: 'principal_paid', value: 'principal_paid' },
  { header: 'interest_paid', value: 'interest_paid' },
  { header: 'fees_paid', value: 'fees_paid' },
  { header: 'occurred_at', value: 'occurred_at' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getLoanActivity({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'loan_events',
    recordId: guarded.tenantId,
    changes: {
      report: 'loan-activity',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  return csvResponse(
    `loan-activity-${guarded.range.from}_to_${guarded.range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
