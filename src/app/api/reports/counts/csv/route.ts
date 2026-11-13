import { guardReportRequest } from '@/lib/reports/api-guard'
import { loadCountsReport, type ShrinkageRow } from '@/lib/counts/report'
import { csvResponse, rowsToCsv, type CsvColumn } from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<ShrinkageRow>> = [
  { header: 'tenant_id', value: 'tenantId' },
  { header: 'shop', value: 'shopName' },
  { header: 'closed_counts', value: 'counts' },
  { header: 'missing_items', value: 'missingItems' },
  { header: 'missing_value', value: 'missingValue' },
  { header: 'written_off_value', value: 'writtenOffValue' },
  { header: 'open_pledge_alerts', value: 'openPledges' },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await loadCountsReport({
    supabase: guarded.supabase,
    tenantId: guarded.tenantId,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'count_sessions',
    recordId: guarded.tenantId,
    changes: {
      report: 'counts',
      format: 'csv',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  return csvResponse(
    `counts-${guarded.range.from}_to_${guarded.range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
