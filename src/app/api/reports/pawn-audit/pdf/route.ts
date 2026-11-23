import { guardReportRequest } from '@/lib/reports/api-guard'
import { reportToday } from '@/lib/reports/range'
import { auditItemDetail, getPawnAudit, type PawnAuditRow } from '@/lib/reports/pawn-audit'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const LABELS = { size: 'Size', serial: 'S/N' }

/** The printed check-off sheet: a box per piece, the ticket on its first line. */
const COLUMNS: ReadonlyArray<ReportPdfColumn<PawnAuditRow>> = [
  { header: 'HERE', width: '6%', align: 'center', mono: true, cell: (r) => (r.item_count === 0 ? '' : '[    ]') },
  { header: 'TICKET', width: '9%', mono: true, cell: (r) => (r.first ? r.ticket_number : '') },
  { header: 'CUSTOMER', width: '18%', cell: (r) => (r.first ? r.customer_name : '') },
  { header: 'ISSUED', width: '9%', mono: true, cell: (r) => (r.first ? r.issue_date : '') },
  { header: 'DUE', width: '9%', mono: true, cell: (r) => (r.first ? r.due_date : '') },
  { header: 'PIECE', width: '6%', align: 'center', mono: true, cell: (r) => (r.item_count === 0 ? '—' : `${r.item_no}/${r.item_count}`) },
  {
    header: 'DESCRIPTION',
    width: '33%',
    cell: (r) => {
      if (r.item_count === 0) return 'NO PIECES RECORDED ON THIS TICKET'
      const detail = auditItemDetail(r, LABELS)
      return detail ? `${r.description}  (${detail})` : r.description
    },
  },
  { header: 'LOAN', width: '10%', align: 'right', mono: true, cell: (r) => (r.first ? money(r.principal) : '') },
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
      format: 'pdf',
      as_of: today,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Pawn Audit — open tickets to check off',
    tenantLabel: guarded.scope.tenantName,
    range: { ...guarded.range, from: today, to: today },
    printedOn: today,
    totals: [
      { label: 'OPEN TICKETS', value: String(result.totals?.tickets ?? 0) },
      { label: 'PIECES', value: String(result.totals?.pieces ?? 0) },
      { label: 'LOANED ON THEM', value: money(result.totals?.principal ?? 0) },
      { label: 'NO PIECES RECORDED', value: String(result.totals?.tickets_without_items ?? 0) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No open pawn tickets.',
  })
  return pdfResponse(`pawn-audit-${today}.pdf`, buffer)
}
