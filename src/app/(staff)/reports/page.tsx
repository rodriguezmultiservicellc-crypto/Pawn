import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { resolveReportScope } from '@/lib/reports/tenant-scope'
import ReportsLanding from './content'

/**
 * /staff/reports — landing page. Card grid of available reports.
 *
 * Cards visible based on the active tenant's modules:
 *   - Pawn Aging / Loan Activity: gated on `has_pawn`.
 *   - Sales Summary / Daily Register: gated on `has_retail`.
 *   - Repair Tickets: gated on `has_repair`.
 *   - Cross-Shop Rollup: gated on tenant_type === 'chain_hq'.
 */
export default async function ReportsLandingPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const scope = await resolveReportScope({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
  })

  // Active tenant module flags (chain_hq tenants don't have flags themselves
  // for retail/repair — we treat HQ as having access to all reports across
  // children).
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_repair, has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()

  const modules = scope.isChainHq
    ? { has_pawn: true, has_repair: true, has_retail: true }
    : {
        has_pawn: tenant?.has_pawn ?? false,
        has_repair: tenant?.has_repair ?? false,
        has_retail: tenant?.has_retail ?? false,
      }

  return <ReportsLanding modules={modules} isChainHq={scope.isChainHq} />
}
