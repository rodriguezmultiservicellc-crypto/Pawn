import { guardReportRequest } from '@/lib/reports/api-guard'
import { reportToday } from '@/lib/reports/range'
import { getDailyRegister, type DailyRegisterRow } from '@/lib/reports/daily-register'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number | null | undefined): string =>
  n == null || !isFinite(n)
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<DailyRegisterRow>> = [
  // Cash by kind (loadDrawerCash), folded to fit the page: PAWN+ is pawn
  // payments and voided loans handed back; OTHER is repair payments less
  // buys and consignor payouts. The CSV has every line on its own.
  { header: 'OPENED', width: '10%', cell: (r) => r.opened_at.slice(0, 16).replace('T', ' ') },
  { header: 'CLOSED', width: '10%', cell: (r) => (r.closed_at ?? '').slice(0, 16).replace('T', ' ') },
  { header: 'OPEN $', width: '7%', align: 'right', mono: true, cell: (r) => money(r.opening_cash) },
  { header: 'SALES+', width: '7%', align: 'right', mono: true, cell: (r) => money(r.cash_sales) },
  { header: 'REFUND−', width: '7%', align: 'right', mono: true, cell: (r) => money(r.cash_refunds) },
  { header: 'PAWN+', width: '7%', align: 'right', mono: true, cell: (r) => money(r.pawn_payments + r.pawn_loan_voids) },
  { header: 'LOANS−', width: '7%', align: 'right', mono: true, cell: (r) => money(r.pawn_loans) },
  { header: 'OTHER', width: '7%', align: 'right', mono: true, cell: (r) => money(r.repair_payments - r.buys - r.consignment_payouts) },
  { header: 'NET', width: '7%', align: 'right', mono: true, cell: (r) => money(r.cash_net) },
  { header: 'CARD+', width: '7%', align: 'right', mono: true, cell: (r) => money(r.card_sales) },
  { header: 'EXP $', width: '7%', align: 'right', mono: true, cell: (r) => money(r.expected_cash) },
  { header: 'CNT $', width: '7%', align: 'right', mono: true, cell: (r) => money(r.closing_cash_counted) },
  { header: 'VAR', width: '6%', align: 'right', mono: true, cell: (r) => money(r.cash_variance) },
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
    printedOn: reportToday(guarded.range),
    totals: [
      { label: 'OPENING CASH', value: money(result.totals?.opening_cash ?? 0) },
      { label: 'CASH SALES', value: money(result.totals?.cash_sales ?? 0) },
      { label: 'PAWN PAYMENTS', value: money(result.totals?.pawn_payments ?? 0) },
      { label: 'LOANS OUT', value: money(result.totals?.pawn_loans ?? 0) },
      { label: 'NET CASH', value: money(result.totals?.cash_net ?? 0) },
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
