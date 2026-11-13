import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { loadCountsReport } from '@/lib/counts/report'
import CountsReportContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

/** Counts and shrinkage per shop; a chain HQ sees one row per child shop. */
export default async function CountsReportPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  // Dates in the shop's timezone (REVIEW-2026-11-11 finding 10).
  const range = await shopReportRange({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    from: params.from,
    to: params.to,
    defaultFromDays: -30,
    defaultToDays: 0,
  })
  const { from, to } = range

  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const report = await loadCountsReport({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range,
  })

  return <CountsReportContent from={from} to={to} report={report} isChainHq={scope.isChainHq} />
}
