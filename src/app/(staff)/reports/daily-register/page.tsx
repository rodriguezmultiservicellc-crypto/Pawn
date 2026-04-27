import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getDailyRegister } from '@/lib/reports/daily-register'
import { todayDateString } from '@/lib/pawn/math'
import DailyRegisterContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

export default async function DailyRegisterPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const params = await props.searchParams
  const today = todayDateString()
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : today
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today

  const scope = await resolveReportScope({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
  })

  const result = await getDailyRegister({
    supabase: ctx.supabase,
    tenantIds: scope.tenantIds,
    range: { from, to },
  })

  return (
    <DailyRegisterContent
      from={from}
      to={to}
      rows={result.rows}
      totals={result.totals ?? {}}
      tenantName={scope.tenantName}
    />
  )
}
