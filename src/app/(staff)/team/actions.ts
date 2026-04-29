'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import type { TenantRole } from '@/types/database-aliases'

/**
 * Team-management server actions: invite a new staff member, change
 * an existing member's role, deactivate / reactivate a member.
 *
 * All gated to owner / chain_admin (managers can VIEW the team but
 * not modify). The 'client' role is intentionally excluded from the
 * staff-side enum below — clients are onboarded through the customer-
 * portal invite flow at /customers/[id], not here.
 */

const STAFF_ROLE_VALUES = [
  'owner',
  'chain_admin',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'appraiser',
] as const satisfies readonly TenantRole[]

export type StaffRole = (typeof STAFF_ROLE_VALUES)[number]

const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(STAFF_ROLE_VALUES),
  full_name: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().min(1).max(120).nullable().optional(),
    )
    .transform((v) => v ?? null),
})

export type InviteState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
  /** Magic link to hand to the invitee when Resend isn't set up yet
   *  for the platform email channel. */
  manualLink?: string | null
  delivered?: 'email' | 'manual'
}

export async function inviteTeamMemberAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
  ])

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    full_name: formData.get('full_name'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    return { fieldErrors }
  }
  const v = parsed.data
  const email = v.email.toLowerCase()

  const admin = createAdminClient()

  // Resolve / create the auth user.
  let userIdNew: string | null = null
  type GenLinkResp = {
    data?: { properties?: { action_link?: string }; user?: { id?: string } }
    error?: { message?: string } | null
  }
  const appUrl = await resolveAppUrl()
  if (!appUrl) return { error: 'app_url_not_configured' }
  const redirectTo = `${appUrl}/login?next=/dashboard`

  let actionLink: string | null = null
  try {
    const tryGen = async (
      type: 'invite' | 'magiclink',
    ): Promise<GenLinkResp> =>
      (await admin.auth.admin.generateLink({
        type,
        email,
        options: { redirectTo },
      })) as unknown as GenLinkResp

    let resp = await tryGen('invite')
    if (resp.error?.message && /already|exists|registered/i.test(resp.error.message)) {
      resp = await tryGen('magiclink')
    }
    if (resp.error) {
      console.error('[team.invite] generateLink error', resp.error.message)
      return { error: 'auth_invite_failed' }
    }
    actionLink = resp.data?.properties?.action_link ?? null
    userIdNew = resp.data?.user?.id ?? null
  } catch (err) {
    console.error('[team.invite] generateLink threw', err)
    return { error: 'auth_invite_failed' }
  }

  // Fall-back: if generateLink didn't return a user.id (some Supabase
  // versions don't), look it up by email via admin.auth.admin.listUsers.
  if (!userIdNew) {
    try {
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 50 })
      const found = list.data.users.find(
        (u) => (u.email ?? '').toLowerCase() === email,
      )
      userIdNew = found?.id ?? null
    } catch (err) {
      console.error('[team.invite] listUsers failed', err)
    }
  }
  if (!userIdNew) return { error: 'auth_lookup_failed' }

  // Upsert the membership row. UNIQUE(user_id, tenant_id) means re-
  // inviting an existing member just rebumps role + reactivates.
  const { error: utErr } = await admin.from('user_tenants').upsert(
    {
      user_id: userIdNew,
      tenant_id: ctx.tenantId,
      role: v.role,
      is_active: true,
    },
    { onConflict: 'user_id,tenant_id' },
  )
  if (utErr) return { error: 'membership_failed' }

  // Seed profile.full_name if provided + missing.
  if (v.full_name) {
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', userIdNew)
      .maybeSingle()
    if (!existingProfile?.full_name) {
      await admin
        .from('profiles')
        .upsert({ id: userIdNew, full_name: v.full_name })
    }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'create',
    tableName: 'user_tenants',
    recordId: userIdNew,
    changes: { invited_email: email, role: v.role },
  })

  revalidatePath('/team')
  return {
    ok: true,
    delivered: 'manual', // platform-side staff invites email is out of scope for v1
    manualLink: actionLink,
  }
}

const roleSchema = z.enum(STAFF_ROLE_VALUES)

export type ChangeRoleState = { ok?: boolean; error?: string }

export async function changeMemberRoleAction(
  _prev: ChangeRoleState,
  formData: FormData,
): Promise<ChangeRoleState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId: actorId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
  ])

  const userIdTarget = String(formData.get('user_id') ?? '')
  const newRole = roleSchema.safeParse(formData.get('role'))
  if (!userIdTarget || !newRole.success) return { error: 'invalid' }

  // Prevent self-demotion from owner — there has to be at least one
  // owner left. Refuse if the actor is the only owner trying to step
  // themselves down.
  if (userIdTarget === actorId && newRole.data !== 'owner') {
    const admin = createAdminClient()
    const { count } = await admin
      .from('user_tenants')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('role', 'owner')
      .eq('is_active', true)
    if ((count ?? 0) <= 1) return { error: 'last_owner' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('user_tenants')
    .update({ role: newRole.data })
    .eq('user_id', userIdTarget)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: actorId,
    action: 'update',
    tableName: 'user_tenants',
    recordId: userIdTarget,
    changes: { new_role: newRole.data },
  })

  revalidatePath('/team')
  return { ok: true }
}

export async function setMemberActiveAction(
  _prev: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { userId: actorId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
  ])

  const userIdTarget = String(formData.get('user_id') ?? '')
  const targetActive = String(formData.get('is_active') ?? '') === 'on'
  if (!userIdTarget) return { error: 'invalid' }

  const admin = createAdminClient()

  // Last-owner guard on deactivation.
  if (!targetActive) {
    const { data: target } = await admin
      .from('user_tenants')
      .select('role')
      .eq('user_id', userIdTarget)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()
    if (target?.role === 'owner') {
      const { count } = await admin
        .from('user_tenants')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .eq('role', 'owner')
        .eq('is_active', true)
      if ((count ?? 0) <= 1) return { error: 'last_owner' }
    }
  }

  const { error } = await admin
    .from('user_tenants')
    .update({ is_active: targetActive })
    .eq('user_id', userIdTarget)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: actorId,
    action: 'update',
    tableName: 'user_tenants',
    recordId: userIdTarget,
    changes: { is_active: targetActive },
  })

  revalidatePath('/team')
  return { ok: true }
}

async function resolveAppUrl(): Promise<string> {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (fromEnv && !fromEnv.includes('localhost')) return fromEnv
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
    const proto =
      h.get('x-forwarded-proto') ??
      (host.includes('localhost') ? 'http' : 'https')
    if (host) return `${proto}://${host}`.replace(/\/$/, '')
  } catch {}
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/$/, '')
  return fromEnv
}
