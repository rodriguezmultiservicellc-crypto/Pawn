import 'server-only'

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'

/** Who may open a repair ticket (same list as createRepairTicketAction). */
export const REPAIR_DRAFT_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'chain_admin',
] as const

/**
 * The guard every repair-draft action starts with: a shop with the repair
 * module and a role that may open a repair ticket. Null = not allowed.
 * Guard first; the client it returns is the one to write with.
 */
export async function repairDraftScope() {
  const ctx = await getCtx()
  if (!ctx?.tenantId) return null
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) return null
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [...REPAIR_DRAFT_ROLES])
  return { supabase, userId, tenantId: ctx.tenantId }
}
