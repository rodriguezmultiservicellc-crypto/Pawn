import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { COUNT_RESOLVE_ROLES, COUNT_ROLES } from '@/lib/counts/types'
import { listCountSessions, loadPledgeAlert } from '@/lib/counts/server'
import CountsContent from './content'

export const dynamic = 'force-dynamic'

/**
 * /inventory/counts — start a case count or vault audit, see counts in
 * progress and the history (patches/0075, PLAN-2026-11-13 Phase 2a).
 */
export default async function CountsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !COUNT_ROLES.includes(ctx.tenantRole)) redirect('/dashboard')
  const tenantId = ctx.tenantId

  const [{ data: tenant }, sessions, pledgeAlert] = await Promise.all([
    ctx.supabase.from('tenants').select('has_pawn').eq('id', tenantId).maybeSingle(),
    listCountSessions(ctx.supabase, [tenantId], { limit: 200 }),
    loadPledgeAlert(ctx.supabase, [tenantId]),
  ])

  return (
    <CountsContent
      sessions={sessions}
      hasPawn={tenant?.has_pawn === true}
      pledgeAlert={COUNT_RESOLVE_ROLES.includes(ctx.tenantRole) ? pledgeAlert : null}
    />
  )
}
