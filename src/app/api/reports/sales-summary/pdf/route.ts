import { guardReportRequest } from '@/lib/reports/api-guard'
import { getSalesSummary, type SalesSummaryRow } from '@/lib/reports/sales-summary'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<SalesSummaryRow>> = [
  { header: 'WHEN', width: '14%', cell: (r) => (r.completed_at ?? '').slice(0, 16).replace('T', ' ') },
  { header: 'SALE #', width: '10%', mono: true, cell: (r) => r.sale_number },
  { header: 'CUSTOMER', width: '20%', cell: (r) => r.customer_name ?? '—' },
  { header: 'KIND', width: '8%', cell: (r) => r.sale_kind },
  { header: 'STATUS', width: '12%', cell: (r) => r.status },
  { header: 'TOTAL', width: '12%', align: 'right', mono: true, cell: (r) => money(r.total) },
  { header: 'RETURNED', width: '12%', align: 'right', mono: true, cell: (r) => money(r.returned_total) },
  { header: 'NET', width: '12%', align: 'right', mono: true, cell: (r) => money(r.net) },
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
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Sales Summary',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'SALES', value: String(result.totals?.units ?? 0) },
      { label: 'GROSS', value: money(result.totals?.total ?? 0) },
      { label: 'RETURNS', value: money(result.totals?.returned ?? 0) },
      { label: 'NET', value: money(result.totals?.net ?? 0) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No completed sales in range.',
  })
  return pdfResponse(
    `sales-summary-${guarded.range.from}_to_${guarded.range.to}.pdf`,
    buffer,
  )
}
