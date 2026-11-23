import { guardReportRequest } from '@/lib/reports/api-guard'
import { reportToday } from '@/lib/reports/range'
import { getPawnAudit, type PawnAuditRow } from '@/lib/reports/pawn-audit'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** One row per piece; the ticket's columns repeat on every row so the file sorts and filters. */
const COLUMNS: ReadonlyArray<CsvColumn<PawnAuditRow>> = [
  { header: 'ticket_number', value: 'ticket_number' },
  { header: 'customer_name', value: 'customer_name' },
  { header: 'issue_date', value: 'issue_date' },
  { header: 'due_date', value: 'due_date' },
  { header: 'status', value: 'status' },
  { header: 'loan_amount', value: 'principal' },
  { header: 'piece', value: 'item_no' },
  { header: 'pieces_on_ticket', value: 'item_count' },
  { header: 'description', value: 'description' },
  { header: 'karat', value: 'karat' },
  { header: 'weight_grams', value: 'weight_grams' },
  { header: 'size', value: 'size' },
  { header: 'serial', value: 'serial' },
  { header: 'loan_id', value: 'loan_id' },
  { header: 'tenant_id', value: 'tenant_id' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getPawnAudit({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
  })
  const today = reportToday(guarded.range)
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'loans',
    recordId: guarded.tenantId,
    changes: {
      report: 'pawn-audit',
      format: 'csv',
      as_of: today,
      row_count: result.rows.length,
    },
  })
  return csvResponse(`pawn-audit-${today}.csv`, rowsToCsv(result.rows, COLUMNS))
}
