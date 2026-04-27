import { guardReportRequest } from '@/lib/reports/api-guard'
import { getInventoryTurn, type InventoryTurnRow } from '@/lib/reports/inventory-turn'
import { pdfResponse } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<InventoryTurnRow>> = [
  { header: 'SKU', width: '10%', mono: true, cell: (r) => r.sku },
  { header: 'DESCRIPTION', width: '24%', cell: (r) => r.description },
  { header: 'CAT', width: '10%', cell: (r) => r.category },
  { header: 'SOURCE', width: '10%', cell: (r) => r.source },
  { header: 'COST', width: '10%', align: 'right', mono: true, cell: (r) => money(r.cost_basis) },
  { header: 'SALE', width: '10%', align: 'right', mono: true, cell: (r) => money(r.sale_price) },
  { header: 'MARGIN', width: '10%', align: 'right', mono: true, cell: (r) => money(r.margin) },
  { header: 'DAYS', width: '8%', align: 'right', mono: true, cell: (r) => String(r.days_in_stock) },
  { header: 'SOLD', width: '8%', mono: true, cell: (r) => r.sold_at.slice(0, 10) },
]

export async function GET(req: Request) {
  const guarded = await guardReportRequest(req)
  if (guarded instanceof Response) return guarded
  const result = await getInventoryTurn({
    supabase: guarded.supabase,
    tenantIds: guarded.scope.tenantIds,
    range: guarded.range,
  })
  await logAudit({
    tenantId: guarded.tenantId,
    userId: guarded.userId,
    action: 'export',
    tableName: 'inventory_items',
    recordId: guarded.tenantId,
    changes: {
      report: 'inventory-turn',
      format: 'pdf',
      from: guarded.range.from,
      to: guarded.range.to,
      row_count: result.rows.length,
    },
  })
  const avg = result.totals?.avg_days_in_stock ?? 0
  const buffer = await renderReportPdf({
    title: 'Inventory Turn',
    tenantLabel: guarded.scope.tenantName,
    range: guarded.range,
    printedOn: todayDateString(),
    totals: [
      { label: 'UNITS', value: String(result.totals?.units ?? 0) },
      { label: 'REVENUE', value: money(result.totals?.gross_revenue ?? 0) },
      { label: 'MARGIN', value: money(result.totals?.gross_margin ?? 0) },
      { label: 'AVG DAYS', value: avg.toFixed(1) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No items sold in range.',
  })
  return pdfResponse(
    `inventory-turn-${guarded.range.from}_to_${guarded.range.to}.pdf`,
    buffer,
  )
}
