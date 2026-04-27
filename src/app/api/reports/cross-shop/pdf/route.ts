import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getCrossShopRollup, type CrossShopRow } from '@/lib/reports/cross-shop'
import { pdfResponse, parseRange } from '@/lib/reports/http'
import { renderReportPdf } from '@/lib/pdf/reports/render-report'
import type { ReportPdfColumn } from '@/lib/pdf/reports/ReportPDF'
import { logAudit } from '@/lib/audit'
import { todayDateString } from '@/lib/pawn/math'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const COLUMNS: ReadonlyArray<ReportPdfColumn<CrossShopRow>> = [
  { header: 'SHOP', width: '20%', cell: (r) => r.tenant_name },
  { header: 'ACTIVE', width: '8%', align: 'right', mono: true, cell: (r) => String(r.active_loans) },
  { header: 'PRINCIPAL', width: '12%', align: 'right', mono: true, cell: (r) => money(r.loans_principal_outstanding) },
  { header: 'RED', width: '6%', align: 'right', mono: true, cell: (r) => String(r.redemptions_in_range) },
  { header: 'FORF', width: '6%', align: 'right', mono: true, cell: (r) => String(r.forfeitures_in_range) },
  { header: 'INTEREST', width: '12%', align: 'right', mono: true, cell: (r) => money(r.interest_income_in_range) },
  { header: 'SALES', width: '8%', align: 'right', mono: true, cell: (r) => String(r.sales_count_in_range) },
  { header: 'NET SALES', width: '12%', align: 'right', mono: true, cell: (r) => money(r.sales_total_in_range) },
  { header: 'REPAIRS', width: '8%', align: 'right', mono: true, cell: (r) => String(r.repair_tickets_in_range) },
  { header: 'INV $', width: '8%', align: 'right', mono: true, cell: (r) => money(r.inventory_revenue_in_range) },
]

export async function GET(req: Request) {
  const ctx = await getCtx()
  if (!ctx) return new Response('unauthorized', { status: 401 })
  if (!ctx.tenantId) return new Response('no_tenant', { status: 403 })

  const scope = await resolveReportScope({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
  })
  if (!scope.isChainHq) return new Response('forbidden', { status: 403 })

  const url = new URL(req.url)
  const range = parseRange(url.searchParams)

  const result = await getCrossShopRollup({
    supabase: ctx.supabase,
    hqTenantId: ctx.tenantId,
    range,
  })

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'export',
    tableName: 'tenants',
    recordId: ctx.tenantId,
    changes: {
      report: 'cross-shop',
      format: 'pdf',
      from: range.from,
      to: range.to,
      row_count: result.rows.length,
    },
  })

  const buffer = await renderReportPdf({
    title: 'Cross-Shop Rollup',
    tenantLabel: scope.tenantName,
    range,
    printedOn: todayDateString(),
    totals: [
      { label: 'ACTIVE LOANS', value: String(result.totals?.active_loans ?? 0) },
      { label: 'PRINCIPAL OUT', value: money(result.totals?.loans_principal_outstanding ?? 0) },
      { label: 'NET SALES', value: money(result.totals?.sales_total ?? 0) },
      { label: 'INTEREST', value: money(result.totals?.interest_income ?? 0) },
    ],
    columns: COLUMNS,
    rows: result.rows,
    emptyMessage: 'No child shops found.',
  })

  return pdfResponse(
    `cross-shop-${range.from}_to_${range.to}.pdf`,
    buffer,
  )
}
