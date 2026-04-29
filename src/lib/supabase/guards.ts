import { redirect } from 'next/navigation'
import { createAdminClient } from './admin'
import { getCtx } from './ctx'
import type { TenantRole } from '@/types/database-aliases'

/**
 * Server-action / route-handler gates. Always call BEFORE any
 * createAdminClient() usage — service-role bypasses RLS, so the guard is
 * the only thing standing between a regular user and the whole database.
 */

/**
 * Require the current user to be a global superadmin. Redirects to /login
 * on unauthenticated and to /no-tenant on authenticated-but-not-superadmin.
 *
 * Returns the admin (service-role) Supabase client for the caller's use.
 * The user-scoped client is also returned for queries that need to be
 * RLS-aware (e.g. cross-tenant reads where you want to defense-in-depth
 * against bugs in the admin path).
 */
export async function requireSuperAdmin() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  // We use the admin client for the role check too — profiles.role can
  // only be read with the user's own RLS scope, so a fresh user with no
  // profile row would 0-row here. Admin check bypasses that risk.
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', ctx.userId)
    .maybeSingle()

  if (profile?.role !== 'superadmin') redirect('/no-tenant')

  return { admin, userId: ctx.userId, supabase: ctx.supabase }
}

/**
 * Require the current user to hold one of the allowed roles at the given
 * tenant. Redirects to /login on unauthenticated and to /no-tenant on
 * insufficient role. Tolerant of `chain_admin` access — if the user is a
 * chain_admin at the parent, they're allowed at every child.
 *
 * Returns the user-scoped Supabase client + userId + the resolved role.
 */
export async function requireRoleInTenant(
  tenantId: string,
  allowed: ReadonlyArray<TenantRole>,
) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const supabase = ctx.supabase

  // Direct membership check first.
  const { data: direct } = await supabase
    .from('user_tenants')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (direct?.role && allowed.includes(direct.role as TenantRole)) {
    return { supabase, userId: ctx.userId, role: direct.role as TenantRole }
  }

  // Chain admin fallback: chain_admin at the parent tenant grants access
  // to every child shop. Only relevant when 'chain_admin' (or any role) is
  // in `allowed` — but since chain_admin should map to staff-level access
  // we always check.
  const { data: tenant } = await supabase
    .from('tenants')
    .select('parent_tenant_id')
    .eq('id', tenantId)
    .maybeSingle()

  if (tenant?.parent_tenant_id) {
    const { data: chainAdmin } = await supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', ctx.userId)
      .eq('tenant_id', tenant.parent_tenant_id)
      .eq('role', 'chain_admin')
      .eq('is_active', true)
      .maybeSingle()

    if (chainAdmin && allowed.includes('chain_admin' as TenantRole)) {
      return { supabase, userId: ctx.userId, role: 'chain_admin' as TenantRole }
    }
  }

  redirect('/no-tenant')
}

/**
 * Convenience wrapper: require staff-level access at the given tenant
 * (owner | chain_admin | manager | pawn_clerk | repair_tech | appraiser).
 * Excludes 'client' (portal users).
 */
export async function requireStaff(tenantId: string) {
  return requireRoleInTenant(tenantId, [
    'owner',
    'chain_admin',
    'manager',
    'pawn_clerk',
    'repair_tech',
    'appraiser',
  ])
}

/**
 * Convenience wrapper: require ownership-level access (owner direct or
 * chain_admin via parent). Used for billing, team management, settings.
 */
export async function requireOwner(tenantId: string) {
  return requireRoleInTenant(tenantId, ['owner', 'chain_admin'])
}

/**
 * Require the current user to hold tenantRole='client' at the given tenant
 * AND have a customers row linked via auth_user_id. Used by every portal
 * server action. Redirects to /login on unauthenticated and to /no-tenant
 * on missing membership / missing customer link.
 *
 * Returns the resolved customerId + tenantId + user-scoped Supabase client.
 * The customer lookup runs via the admin client because the freshly-invited
 * client may not yet have any user_tenants row covering the customers RLS
 * policy on read; we already verified the role via direct SQL.
 */
export async function requireClientInTenant(tenantId: string): Promise<{
  supabase: Awaited<ReturnType<typeof import('./server').createClient>>
  userId: string
  tenantId: string
  customerId: string
}> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const supabase = ctx.supabase

  const { data: membership } = await supabase
    .from('user_tenants')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (membership?.role !== 'client') redirect('/no-tenant')

  // Resolve the customer row via the admin client — RLS already protects
  // staff data; this lookup just maps auth.uid() -> customers.id without
  // depending on the customer's own SELECT policy being live.
  const admin = createAdminClient()
  type CustomerLink = { id: string; tenant_id: string }
  const customerLookup = await admin
    .from('customers')
    .select('id, tenant_id')
    .eq('auth_user_id', ctx.userId)
    .is('deleted_at', null)
    .maybeSingle()
  const customer = (customerLookup.data ?? null) as CustomerLink | null

  if (!customer || customer.tenant_id !== tenantId) {
    redirect('/no-tenant')
  }

  return {
    supabase,
    userId: ctx.userId,
    tenantId,
    customerId: customer.id,
  }
}
