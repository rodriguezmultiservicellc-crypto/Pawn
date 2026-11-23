import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { shopReportRange } from '@/lib/reports/shop-range'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import { getPawnAudit } from '@/lib/reports/pawn-audit'
import PawnAuditContent from './content'

export const dynamic = 'force-dynamic'

export default async function PawnAuditPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/reports')

  // The audit is a picture of now. The range is only the shop's today, for
  // the export links and the "printed on" line.
  const range = await shopReportRange({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    defaultFromDays: 0,
    defaultToDays: 0,
  })

  const scope = await resolveReportScope({ supabase: ctx.supabase, tenantId: ctx.tenantId })
  const result = await getPawnAudit({ supabase: ctx.supabase, tenantIds: scope.tenantIds })

  return <PawnAuditContent today={range.to} rows={result.rows} totals={result.totals ?? {}} />
}
