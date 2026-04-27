import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getCrossShopRollup, type CrossShopRow } from '@/lib/reports/cross-shop'
import {
  csvResponse,
  parseRange,
  rowsToCsv,
  type CsvColumn,
} from '@/lib/reports/http'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLUMNS: ReadonlyArray<CsvColumn<CrossShopRow>> = [
  { header: 'tenant_id', value: 'tenant_id' },
  { header: 'tenant_name', value: 'tenant_name' },
  { header: 'active_loans', value: 'active_loans' },
  { header: 'loans_principal_outstanding', value: 'loans_principal_outstanding' },
  { header: 'redemptions_in_range', value: 'redemptions_in_range' },
  { header: 'forfeitures_in_range', value: 'forfeitures_in_range' },
  { header: 'interest_income_in_range', value: 'interest_income_in_range' },
  { header: 'sales_count_in_range', value: 'sales_count_in_range' },
  { header: 'sales_total_in_range', value: 'sales_total_in_range' },
  { header: 'repair_tickets_in_range', value: 'repair_tickets_in_range' },
  { header: 'inventory_units_sold_in_range', value: 'inventory_units_sold_in_range' },
  { header: 'inventory_revenue_in_range', value: 'inventory_revenue_in_range' },
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
      format: 'csv',
      from: range.from,
      to: range.to,
      row_count: result.rows.length,
    },
  })

  return csvResponse(
    `cross-shop-${range.from}_to_${range.to}.csv`,
    rowsToCsv(result.rows, COLUMNS),
  )
}
