import { NextResponse } from 'next/server'
import { getCtx } from '@/lib/supabase/ctx'
import type { TenantRole } from '@/types/database-aliases'

/**
 * Who may call the pawn-intake AI routes (/api/ai/voice/pawn-intake,
 * /api/ai/vision/pawn-item): the same people who can write a pawn ticket
 * from the form, in a shop that has the pawn module.
 *
 * A route handler cannot use requireRoleInTenant() — it redirect()s, which
 * is a server-action answer, not a JSON 4xx. This is that guard as JSON.
 */

const ALLOWED_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
]

type Ctx = NonNullable<Awaited<ReturnType<typeof getCtx>>>

export type PawnIntakeGate =
  | { ok: true; ctx: Ctx; tenantId: string; hasFirearms: boolean }
  | { ok: false; response: NextResponse }

function refuse(status: number, error: string): PawnIntakeGate {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

export async function pawnIntakeGate(): Promise<PawnIntakeGate> {
  const ctx = await getCtx()
  if (!ctx) return refuse(401, 'Not signed in.')
  if (!ctx.tenantId) return refuse(403, 'No active tenant.')
  const tenantId = ctx.tenantId

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_firearms, parent_tenant_id')
    .eq('id', tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) return refuse(403, 'Pawn module is disabled for this tenant.')

  // Role gate.
  const { data: membership } = await ctx.supabase
    .from('user_tenants')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()
  let role = membership?.role as TenantRole | undefined
  if ((!role || !ALLOWED_ROLES.includes(role)) && tenant.parent_tenant_id) {
    // Chain-admin fallback: a chain_admin at the parent tenant counts for
    // every child shop.
    const { data: ca } = await ctx.supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', ctx.userId)
      .eq('tenant_id', tenant.parent_tenant_id)
      .eq('role', 'chain_admin')
      .eq('is_active', true)
      .maybeSingle()
    if (ca?.role === 'chain_admin') role = 'chain_admin'
  }
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return refuse(403, 'Insufficient role for pawn intake.')
  }

  return { ok: true, ctx, tenantId, hasFirearms: !!tenant.has_firearms }
}
