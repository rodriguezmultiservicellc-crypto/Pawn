import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getCrossShopRollup } from '@/lib/reports/cross-shop'
import { todayDateString, addDaysIso } from '@/lib/pawn/math'
import CrossShopContent from './content'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ from?: string; to?: string }>

export default async function CrossShopPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Gate: only accessible for chain_hq tenants.
  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  if (!scope.isChainHq) redirect('/reports')

  const params = await props.searchParams
  const today = todayDateString()
  const defaultFrom = addDaysIso(today, -30)
  const from =
    params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : defaultFrom
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today

  const result = await getCrossShopRollup({
    supabase: ctx.supabase,
    hqTenantId: ctx.tenantId,
    range: { from, to },
  })

  return (
    <CrossShopContent
      from={from}
      to={to}
      rows={result.rows}
      totals={result.totals ?? {}}
    />
  )
}
