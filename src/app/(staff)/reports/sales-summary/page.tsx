import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getSalesSummary } from '@/lib/reports/sales-summary'
import { todayDateString, addDaysIso } from '@/lib/pawn/math'
import SalesSummaryContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

export default async function SalesSummaryPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const today = todayDateString()
  const defaultFrom = addDaysIso(today, -30)
  const from =
    params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaultFrom
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today

  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const result = await getSalesSummary({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range: { from, to },
  })

  return (
    <SalesSummaryContent
      from={from}
      to={to}
      rows={result.rows}
      totals={result.totals ?? {}}
    />
  )
}
