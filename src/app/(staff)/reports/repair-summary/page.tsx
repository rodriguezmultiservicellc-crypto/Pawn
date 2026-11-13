import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getRepairSummary } from '@/lib/reports/repair-summary'
import RepairSummaryContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

export default async function RepairSummaryPage(props: {
  searchParams: SearchParams
}) {
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
  const result = await getRepairSummary({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range,
  })

  return (
    <RepairSummaryContent
      from={from}
      to={to}
      rows={result.rows}
      totals={result.totals ?? {}}
    />
  )
}
