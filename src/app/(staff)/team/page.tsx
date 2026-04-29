import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { createAdminClient } from '@/lib/supabase/admin'
import TeamContent, { type TeamMemberRow } from './content'
import type { TenantRole } from '@/types/database-aliases'

const TEAM_VIEW_ROLES = new Set<TenantRole>([
  'owner',
  'chain_admin',
  'manager',
])
const TEAM_MANAGE_ROLES = new Set<TenantRole>(['owner', 'chain_admin'])

/**
 * /team — list staff at the active tenant + invite/remove flow.
 *
 * Read access: owner / chain_admin / manager.
 * Write access (invite, role change, deactivate): owner / chain_admin
 * only — managers can SEE who's on the team but can't change roles
 * or revoke. The page passes a `canManage` prop so the UI hides the
 * action affordances for managers.
 */
export default async function TeamPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  if (!ctx.tenantRole || !TEAM_VIEW_ROLES.has(ctx.tenantRole)) {
    redirect('/dashboard')
  }
  const canManage = TEAM_MANAGE_ROLES.has(ctx.tenantRole)

  const admin = createAdminClient()

  // Pull all user_tenants rows (active + inactive) with the joined
  // profile + auth.users email. Auth-side data needs admin client.
  const { data: members } = await admin
    .from('user_tenants')
    .select(
      'id, user_id, role, is_active, created_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: true })

  const userIds = Array.from(
    new Set((members ?? []).map((m) => m.user_id).filter(Boolean) as string[]),
  )

  // Profile lookup (full_name, language).
  const profileMap = new Map<
    string,
    { full_name: string | null; language: string | null }
  >()
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name, language')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      profileMap.set(p.id, {
        full_name: p.full_name,
        language: p.language,
      })
    }
  }

  // Auth-side lookup for email + last_sign_in_at. We loop because
  // admin.auth.admin.getUserById is single-call. Cap the page size in
  // the UI to avoid a big fan-out — for v1 we accept the latency on
  // small teams.
  const authMap = new Map<
    string,
    { email: string | null; lastSignInAt: string | null }
  >()
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      const u = data?.user
      authMap.set(uid, {
        email: u?.email ?? null,
        lastSignInAt: u?.last_sign_in_at ?? null,
      })
    }),
  )

  const rows: TeamMemberRow[] = (members ?? []).map((m) => {
    const profile = profileMap.get(m.user_id) ?? null
    const auth = authMap.get(m.user_id) ?? null
    return {
      id: m.id,
      userId: m.user_id,
      email: auth?.email ?? null,
      fullName: profile?.full_name ?? null,
      role: m.role as TenantRole,
      isActive: m.is_active,
      lastSignInAt: auth?.lastSignInAt ?? null,
      memberSince: m.created_at,
      isYou: m.user_id === ctx.userId,
    }
  })

  return (
    <TeamContent
      tenantId={ctx.tenantId}
      members={rows}
      canManage={canManage}
      currentUserId={ctx.userId}
    />
  )
}
