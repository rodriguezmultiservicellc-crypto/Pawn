import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getSalesTaxReport } from '@/lib/reports/sales-tax'
import SalesTaxReportContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

/**
 * /reports/sales-tax — tax collected by tax line, sales with no tax by
 * reason, and the tax given back through returns and voids.
 */
export default async function SalesTaxReportPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  // Dates in the shop's timezone, like every report.
  const range = await shopReportRange({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    from: params.from,
    to: params.to,
    defaultFromDays: -30,
    defaultToDays: 0,
  })
  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const report = await getSalesTaxReport({ supabase: ctx.supabase, tenantIds: scope.tenantIds, range })

  return <SalesTaxReportContent from={range.from} to={range.to} report={report} />
}
