import { guardReportRequest } from '@/lib/reports/api-guard'
import { reportToday } from '@/lib/reports/range'
import { getSalesTaxReport } from '@/lib/reports/sales-tax'
import { salesTaxPdfRows, type SalesTaxPdfRow } from '@/lib/reports/sales-tax-export'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const moneyOrBlank = (n: number | null): string => (n == null ? '' : money(n))

const COLUMNS: ReadonlyArray<ReportPdfColumn<SalesTaxPdfRow>> = [
  { header: '', width: '8%', cell: (r) => r.section },
  { header: 'TAX LINE / REASON', width: '30%', cell: (r) => r.label },
  { header: 'RATE', width: '8%', align: 'right', mono: true, cell: (r) => r.rate },
  { header: 'SALES', width: '8%', align: 'right', mono: true, cell: (r) => r.count },
  { header: 'AMOUNT', width: '13%', align: 'right', mono: true, cell: (r) => money(r.amount) },
  { header: 'TAX', width: '11%', align: 'right', mono: true, cell: (r) => moneyOrBlank(r.tax) },
  { header: 'REFUNDED', width: '11%', align: 'right', mono: true, cell: (r) => moneyOrBlank(r.tax_refunded) },
  { header: 'NET TAX', width: '11%', align: 'right', mono: true, cell: (r) => moneyOrBlank(r.net_tax) },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const report = await getSalesTaxReport({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  const rows = salesTaxPdfRows(report)
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'sales',
    recordId: guarded.tenantId,
    changes: {
      report: 'sales-tax',
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: rows.length,
    },
  })
  const { totals } = report
  const buffer = await renderReportPdf({
    title: 'Sales Tax',
    subtitle: 'Sales completed in the range. Returns and voids count on the day they were made.',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: reportToday(guarded.range),
    totals: [
      { label: 'SALES BEFORE TAX', value: money(totals.gross) },
      { label: 'NO TAX', value: money(totals.exempt + totals.untaxed) },
      { label: 'TAXABLE', value: money(totals.taxable) },
      { label: 'TAX COLLECTED', value: money(totals.tax_collected) },
      { label: 'TAX REFUNDED', value: money(totals.tax_refunded) },
      { label: 'NET TAX', value: money(totals.net_tax) },
    ],
    columns: COLUMNS,
    rows,
    emptyMessage: 'No completed sales in range.',
  })
  return pdfResponse(`sales-tax-${guarded.range.from}_to_${guarded.range.to}.pdf`, buffer)
}
