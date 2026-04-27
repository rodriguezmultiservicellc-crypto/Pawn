import { guardReportRequest } from '@/lib/reports/api-guard'
import { getLoanActivity, type LoanActivityRow } from '@/lib/reports/loan-activity'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<LoanActivityRow>> = [
  { header: 'WHEN', width: '14%', cell: (r) => r.occurred_at.slice(0, 16).replace('T', ' ') },
  { header: 'TICKET', width: '10%', mono: true, cell: (r) => r.ticket_number },
  { header: 'CUSTOMER', width: '20%', cell: (r) => r.customer_name },
  { header: 'EVENT', width: '12%', cell: (r) => r.event_type },
  { header: 'AMOUNT', width: '11%', align: 'right', mono: true, cell: (r) => money(r.amount) },
  { header: 'PRINCIPAL', width: '11%', align: 'right', mono: true, cell: (r) => money(r.principal_paid) },
  { header: 'INTEREST', width: '11%', align: 'right', mono: true, cell: (r) => money(r.interest_paid) },
  { header: 'FEES', width: '11%', align: 'right', mono: true, cell: (r) => money(r.fees_paid) },
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
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Loan Activity',
    subtitle: 'Redemptions, forfeitures, and interest income.',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'REDEMPTIONS', value: String(result.totals?.redemptions ?? 0) },
      { label: 'FORFEITURES', value: String(result.totals?.forfeitures ?? 0) },
      { label: 'INTEREST', value: money(result.totals?.interest_income ?? 0) },
      { label: 'PRINCIPAL', value: money(result.totals?.principal_collected ?? 0) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No loan events in range.',
  })
  return pdfResponse(
    `loan-activity-${guarded.range.from}_to_${guarded.range.to}.pdf`,
    buffer,
  )
}
