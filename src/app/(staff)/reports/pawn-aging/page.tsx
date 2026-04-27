import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getPawnAging } from '@/lib/reports/pawn-aging'
import { todayDateString, addDaysIso } from '@/lib/pawn/math'
import PawnAgingContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

export default async function PawnAgingPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const today = todayDateString()
  // Pawn aging defaults to today..today+30 if no params.
  const defaultTo = addDaysIso(today, 30)
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : today
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : defaultTo

  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const result = await getPawnAging({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range: { from, to },
  })

  return (
    <PawnAgingContent
      from={from}
      to={to}
      rows={result.rows}
      totals={result.totals ?? {}}
    />
  )
}
