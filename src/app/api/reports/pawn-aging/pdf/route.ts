import { guardReportRequest } from '@/lib/reports/api-guard'
import { getPawnAging, type PawnAgingRow } from '@/lib/reports/pawn-aging'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<PawnAgingRow>> = [
  { header: 'TICKET', width: '12%', mono: true, cell: (r) => r.ticket_number },
  { header: 'CUSTOMER', width: '24%', cell: (r) => r.customer_name },
  { header: 'PRINCIPAL', width: '12%', align: 'right', mono: true, cell: (r) => money(r.principal) },
  { header: 'DUE', width: '12%', mono: true, cell: (r) => r.due_date },
  { header: 'DAYS', width: '8%', align: 'right', mono: true, cell: (r) => String(r.days_to_due) },
  { header: 'STATUS', width: '12%', cell: (r) => r.status },
  { header: 'BUCKET', width: '20%', cell: (r) => r.bucket },
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
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Pawn Aging',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'PRINCIPAL', value: money(result.totals?.principal ?? 0) },
      { label: 'OVERDUE', value: String(result.totals?.overdue ?? 0) },
      { label: 'DUE 0–7', value: String(result.totals?.due_0_7 ?? 0) },
      { label: 'DUE 15–30', value: String(result.totals?.due_15_30 ?? 0) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No active loans in range.',
  })
  return pdfResponse(
    `pawn-aging-${guarded.range.from}_to_${guarded.range.to}.pdf`,
    buffer,
  )
}
