import { guardReportRequest } from '@/lib/reports/api-guard'
import { loadCountsReport, type ShrinkageRow } from '@/lib/counts/report'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<ShrinkageRow>> = [
  { header: 'SHOP', width: '30%', cell: (r) => r.shopName },
  { header: 'COUNTS', width: '10%', align: 'right', mono: true, cell: (r) => String(r.counts) },
  { header: 'MISSING', width: '12%', align: 'right', mono: true, cell: (r) => String(r.missingItems) },
  { header: 'MISSING VALUE', width: '16%', align: 'right', mono: true, cell: (r) => money(r.missingValue) },
  { header: 'WRITTEN OFF', width: '16%', align: 'right', mono: true, cell: (r) => money(r.writtenOffValue) },
  { header: 'OPEN PLEDGES', width: '16%', align: 'right', mono: true, cell: (r) => String(r.openPledges) },
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
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Counts and Shrinkage',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'COUNTS', value: String(result.totals.counts) },
      { label: 'MISSING', value: String(result.totals.missingItems) },
      { label: 'MISSING VALUE', value: money(result.totals.missingValue) },
      { label: 'WRITTEN OFF', value: money(result.totals.writtenOffValue) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No shops in scope.',
  })
  return pdfResponse(`counts-${guarded.range.from}_to_${guarded.range.to}.pdf`, buffer)
}
