import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { loadCountsReport } from '@/lib/counts/report'
import { todayDateString, addDaysIso } from '@/lib/pawn/math'
import CountsReportContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

/** Counts and shrinkage per shop; a chain HQ sees one row per child shop. */
export default async function CountsReportPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const today = todayDateString()
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : addDaysIso(today, -30)
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today

  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const report = await loadCountsReport({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    tenantIds: scope.tenantIds,
    range: { from, to },
  })

  return <CountsReportContent from={from} to={to} report={report} isChainHq={scope.isChainHq} />
}
