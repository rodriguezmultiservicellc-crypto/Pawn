import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireStaff } from '@/lib/supabase/guards'
import { getSpotFreshness } from '@/lib/spot-prices/lookup'
import { loadRateMaps } from '@/lib/metal-counter/rates'
import ToolsContent, { type RecentCalculation } from './content'

export const dynamic = 'force-dynamic'

/**
 * Bench calculators (brief Phase 4.1). Pure math on the client; the only
 * database traffic is the per-user "recent calculations" list
 * (patches/0066). Any staff role — a repair tech sizing a ring needs this
 * as much as the pawn clerk pricing scrap.
 */
export default async function ToolsPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireStaff(ctx.tenantId)

  const [rates, freshness, recentRes] = await Promise.all([
    loadRateMaps(ctx.tenantId),
    getSpotFreshness(),
    supabase
      .from('bench_calculations')
      .select('id, calculator, label, inputs, result, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  const recent: RecentCalculation[] = (recentRes.data ?? []).map((r) => ({
    id: r.id,
    calculator: r.calculator as RecentCalculation['calculator'],
    label: r.label,
    inputs: (r.inputs ?? {}) as Record<string, unknown>,
    result: (r.result ?? {}) as Record<string, unknown>,
    created_at: r.created_at,
  }))

  return <ToolsContent rates={rates} freshness={freshness} recent={recent} />
}
