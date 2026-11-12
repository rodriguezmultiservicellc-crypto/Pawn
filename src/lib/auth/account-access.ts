import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { AccountAccess } from './account-link-policy'

/**
 * Look up an auth account and what it can reach, with the service-role
 * client. Used before minting any sign-in link on someone's behalf — see
 * account-link-policy.ts for the rules these facts feed.
 *
 * Guard FIRST (requireRoleInTenant), then call these.
 */

/** Exact, case-insensitive account lookup by email (patches/0071). */
export async function findAccountIdByEmail(
  admin: SupabaseClient<Database>,
  email: string,
): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('auth_user_id_by_email', {
    p_email: email,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, userId: typeof data === 'string' && data ? data : null }
}

/**
 * What an account can reach: superadmin flag + every membership, active or
 * not (a deactivated owner is still not an account to hand out).
 */
export async function loadAccountAccess(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<{ ok: true; access: AccountAccess } | { ok: false; error: string }> {
  const [profile, memberships] = await Promise.all([
    admin.from('profiles').select('role').eq('id', userId).maybeSingle(),
    admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId),
  ])
  if (profile.error) return { ok: false, error: profile.error.message }
  if (memberships.error) return { ok: false, error: memberships.error.message }

  const staffTenantIds: string[] = []
  const clientTenantIds: string[] = []
  for (const m of memberships.data ?? []) {
    if (m.role === 'client') clientTenantIds.push(m.tenant_id)
    else staffTenantIds.push(m.tenant_id)
  }
  return {
    ok: true,
    access: {
      userId,
      isSuperadmin: profile.data?.role === 'superadmin',
      staffTenantIds,
      clientTenantIds,
    },
  }
}

/** Convenience: account + access by email, or `access: null` when none. */
export async function loadAccountAccessByEmail(
  admin: SupabaseClient<Database>,
  email: string,
): Promise<
  { ok: true; access: AccountAccess | null } | { ok: false; error: string }
> {
  const found = await findAccountIdByEmail(admin, email)
  if (!found.ok) return found
  if (!found.userId) return { ok: true, access: null }
  return loadAccountAccess(admin, found.userId)
}
