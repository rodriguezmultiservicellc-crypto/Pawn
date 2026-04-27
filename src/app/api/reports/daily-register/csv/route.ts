import { guardReportRequest } from '@/lib/reports/api-guard'
import { getDailyRegister } from '@/lib/reports/daily-register'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'
import type { DailyRegisterRow } from '@/lib/reports/daily-register'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<DailyRegisterRow>> = [
  { header: 'session_id', value: 'session_id' },
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'status', value: 'status' },
  { header: 'opened_at', value: 'opened_at' },
  { header: 'closed_at', value: 'closed_at' },
  { header: 'opening_cash', value: 'opening_cash' },
  { header: 'cash_sales', value: 'cash_sales' },
  { header: 'cash_refunds', value: 'cash_refunds' },
  { header: 'card_sales', value: 'card_sales' },
  { header: 'card_refunds', value: 'card_refunds' },
  { header: 'expected_cash', value: 'expected_cash' },
  { header: 'closing_cash_counted', value: 'closing_cash_counted' },
  { header: 'cash_variance', value: 'cash_variance' },
  { header: 'card_batch_total', value: 'card_batch_total' },
  { header: 'notes', value: 'notes' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getDailyRegister({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'register_sessions',
    recordId: guarded.tenantId,
    changes: {
      report: 'daily-register',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const body = rowsToCsv(result.rows, COLUMNS)
  return csvResponse(
    `daily-register-${guarded.range.from}_to_${guarded.range.to}.csv`,
    body,
  )
}
