import { guardReportRequest } from '@/lib/reports/api-guard'
import { getRepairSummary, type RepairSummaryRow } from '@/lib/reports/repair-summary'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number | null): string =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<RepairSummaryRow>> = [
  { header: 'WHEN', width: '12%', cell: (r) => r.created_at.slice(0, 16).replace('T', ' ') },
  { header: 'TICKET', width: '10%', mono: true, cell: (r) => r.ticket_number },
  { header: 'CUSTOMER', width: '18%', cell: (r) => r.customer_name },
  { header: 'SERVICE', width: '10%', cell: (r) => r.service_type },
  { header: 'TITLE', width: '14%', cell: (r) => r.title },
  { header: 'STATUS', width: '10%', cell: (r) => r.status },
  { header: 'QUOTE', width: '8%', align: 'right', mono: true, cell: (r) => money(r.quote_amount) },
  { header: 'DEPOSIT', width: '8%', align: 'right', mono: true, cell: (r) => money(r.deposit_amount) },
  { header: 'PAID', width: '10%', align: 'right', mono: true, cell: (r) => money(r.paid_amount) },
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
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Repair Tickets Summary',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'TICKETS', value: String(result.totals?.tickets ?? 0) },
      { label: 'DEPOSITS', value: money(result.totals?.deposits ?? 0) },
      { label: 'COLLECTED', value: money(result.totals?.collected ?? 0) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No repair tickets created in range.',
  })
  return pdfResponse(
    `repair-summary-${guarded.range.from}_to_${guarded.range.to}.pdf`,
    buffer,
  )
}
