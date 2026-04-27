import { guardReportRequest } from '@/lib/reports/api-guard'
import { getDailyRegister, type DailyRegisterRow } from '@/lib/reports/daily-register'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number | null | undefined): string =>
  n == null || !isFinite(n)
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<DailyRegisterRow>> = [
  { header: 'OPENED', width: '14%', cell: (r) => r.opened_at.slice(0, 16).replace('T', ' ') },
  { header: 'CLOSED', width: '14%', cell: (r) => (r.closed_at ?? '').slice(0, 16).replace('T', ' ') },
  { header: 'STATUS', width: '8%', cell: (r) => r.status },
  { header: 'OPEN $', width: '8%', align: 'right', mono: true, cell: (r) => money(r.opening_cash) },
  { header: 'CASH+', width: '8%', align: 'right', mono: true, cell: (r) => money(r.cash_sales) },
  { header: 'CASH−', width: '8%', align: 'right', mono: true, cell: (r) => money(r.cash_refunds) },
  { header: 'CARD+', width: '8%', align: 'right', mono: true, cell: (r) => money(r.card_sales) },
  { header: 'CARD−', width: '8%', align: 'right', mono: true, cell: (r) => money(r.card_refunds) },
  { header: 'EXP $', width: '8%', align: 'right', mono: true, cell: (r) => money(r.expected_cash) },
  { header: 'CNT $', width: '8%', align: 'right', mono: true, cell: (r) => money(r.closing_cash_counted) },
  { header: 'VAR', width: '8%', align: 'right', mono: true, cell: (r) => money(r.cash_variance) },
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
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const buffer = await renderReportPdf({
    title: 'Daily Register',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'OPENING CASH', value: money(result.totals?.opening_cash ?? 0) },
      { label: 'CASH SALES', value: money(result.totals?.cash_sales ?? 0) },
      { label: 'CARD SALES', value: money(result.totals?.card_sales ?? 0) },
      { label: 'SESSIONS', value: String(result.rows.length) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No register sessions in range.',
  })
  return pdfResponse(
    `daily-register-${guarded.range.from}_to_${guarded.range.to}.pdf`,
    buffer,
  )
}
