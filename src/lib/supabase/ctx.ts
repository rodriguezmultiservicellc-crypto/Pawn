import { cookies } from 'next/headers'
import { createClient } from './server'
import type { GlobalRole, TenantRole } from '@/types/database-aliases'

export const ACTIVE_TENANT_COOKIE = 'pawn-active-tenant'

export type UserCtx = {
  userId: string
  email: string | null
  globalRole: GlobalRole
  tenantRole: TenantRole | null
  /** Active tenant ID. Null when the user has no membership AND no profile
   *  fallback (fresh signup, or superadmin without an active tenant cookie). */
  tenantId: string | null
  /** The user-scoped Supabase client for direct queries. RLS applies. */
  supabase: Awaited<ReturnType<typeof createClient>>
}

/**
 * Resolve the current user + global role + active tenant + tenant role.
 *
 * Resolution rules:
 *   1. Active tenant comes from the `pawn-active-tenant` cookie first.
 *   2. Falls back to profiles.tenant_id (the home tenant set at onboarding).
 *   3. tenantRole queries user_tenants for (user, active tenant). NULL when
 *      the user has no membership at the active tenant.
 *
 * Returns null when the request is unauthenticated. Server components and
 * layouts call this at the top and redirect on null.
 */
export async function getCtx(): Promise<UserCtx | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const cookieStore = await cookies()
  const cookieTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  const globalRole = (profile?.role as GlobalRole) ?? null
  const tenantId =
    cookieTenantId ?? (profile?.tenant_id as string | null) ?? null

  let tenantRole: TenantRole | null = null
  if (tenantId) {
    const { data: ut } = await supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    tenantRole = (ut?.role as TenantRole) ?? null
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    globalRole,
    tenantRole,
    tenantId,
    supabase,
  }
}
