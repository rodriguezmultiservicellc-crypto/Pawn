import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getTips } from '@/lib/reports/tips'
import TipsReportContent from './content'

export const dynamic = 'force-dynamic'

/** Who may see what each employee was tipped: the people who run payroll. */
const VIEW_ROLES = new Set(['owner', 'chain_admin', 'manager'])

type SearchParams = Promise<{ from?: string; to?: string }>

/** /reports/tips — card reader tips, per employee (patches/0096). */
export default async function TipsReportPage(props: { searchParams: SearchParams }) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !VIEW_ROLES.has(ctx.tenantRole)) redirect('/reports')

  const params = await props.searchParams
  const range = await shopReportRange({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    from: params.from,
    to: params.to,
    defaultFromDays: -30,
    defaultToDays: 0,
  })
  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const result = await getTips({ supabase: ctx.supabase, tenantIds: scope.tenantIds, range })

  // Employee names. The role check above is the guard; profiles are read with
  // the service-role client only for ids that appear on this shop's own tips.
  const ids = [...new Set(result.rows.map((r) => r.employee_id).filter((v): v is string => !!v))]
  const names: Record<string, string> = {}
  if (ids.length > 0) {
    const { data: profiles } = await createAdminClient().from('profiles').select('id, full_name').in('id', ids)
    for (const p of profiles ?? []) if (p.full_name) names[p.id] = p.full_name
  }

  return (
    <TipsReportContent
      from={range.from}
      to={range.to}
      rows={result.rows}
      byEmployee={result.byEmployee}
      total={result.total}
      names={names}
    />
  )
}
