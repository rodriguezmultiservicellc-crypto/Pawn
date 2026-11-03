import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { getSpotFreshness } from '@/lib/spot-prices/lookup'
import CalculatorContent from './content'

/**
 * Standalone "what would I loan on this?" calculator. Available to any
 * pawn-handling staff role. The value floor is melt × tenant multiplier;
 * operator can override the LTV to model different policies.
 */
export default async function PawnCalculatorPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Pawn module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'chain_admin',
    'appraiser',
  ])

  // 24h stale-price rule — every melt figure here comes from the feed.
  const spotFreshness = await getSpotFreshness()

  return <CalculatorContent tenantId={ctx.tenantId} spotFreshness={spotFreshness} />
}
