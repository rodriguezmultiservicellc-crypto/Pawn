'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ACTIVE_TENANT_COOKIE } from '@/lib/supabase/middleware'
import { consumePortalInvite } from '@/lib/portal/invite'
import { logAudit } from '@/lib/audit'

export type ClaimState = { error?: string }

/**
 * Customer-side action: bind the signed-in auth.users row to the
 * customer record, create the user_tenants(role='client') row if it
 * doesn't exist, mark the invite consumed, and forward to /portal.
 *
 * All three writes are admin-client (service-role) because the
 * caller is a brand-new auth user with no memberships yet — RLS
 * policies on user_tenants and customers would otherwise block.
 */
export async function claimPortalAction(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const token = String(formData.get('token') ?? '')
  if (!token) return { error: 'token_missing' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthenticated' }

  const admin = createAdminClient()

  // Re-validate the invite freshly (the page-load check could be stale
  // if the user sat on the confirm screen for a while).
  const { data: invite } = await admin
    .from('customer_portal_invites')
    .select('id, tenant_id, customer_id, email, expires_at, consumed_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { error: 'invalid' }
  if (invite.consumed_at) return { error: 'already_used' }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { error: 'expired' }
  }
  if ((user.email ?? '').toLowerCase() !== invite.email.toLowerCase()) {
    return { error: 'wrong_user' }
  }

  // Re-check the customer hasn't been claimed by someone else.
  const { data: customer } = await admin
    .from('customers')
    .select('id, tenant_id, auth_user_id, deleted_at')
    .eq('id', invite.customer_id)
    .maybeSingle()
  if (!customer || customer.deleted_at) return { error: 'invalid' }
  if (customer.auth_user_id && customer.auth_user_id !== user.id) {
    return { error: 'already_linked_other' }
  }

  // 1. Link the customer row → auth user.
  if (customer.auth_user_id !== user.id) {
    const { error: linkErr } = await admin
      .from('customers')
      .update({ auth_user_id: user.id })
      .eq('id', customer.id)
    if (linkErr) return { error: 'link_failed' }
  }

  // 2. Insert user_tenants(role='client') if missing. Active = TRUE.
  //    UNIQUE(user_id, tenant_id) on the table means re-running is safe
  //    via upsert.
  const { error: utErr } = await admin
    .from('user_tenants')
    .upsert(
      {
        user_id: user.id,
        tenant_id: invite.tenant_id,
        role: 'client',
        is_active: true,
      },
      { onConflict: 'user_id,tenant_id' },
    )
  if (utErr) return { error: 'membership_failed' }

  // 3. Mark the invite consumed.
  const consumed = await consumePortalInvite({
    token,
    consumedBy: user.id,
  })
  if (!consumed) return { error: 'consume_failed' }

  // 4. Audit.
  await logAudit({
    tenantId: invite.tenant_id,
    userId: user.id,
    action: 'portal_invite_consumed',
    tableName: 'customer_portal_invites',
    recordId: invite.id,
    changes: { customer_id: customer.id },
  })

  // 5. Set the active-tenant cookie + redirect to the portal.
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TENANT_COOKIE, invite.tenant_id, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  redirect('/portal/loans')
}
