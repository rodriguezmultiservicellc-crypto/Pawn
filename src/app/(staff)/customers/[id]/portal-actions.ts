'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createPortalInvite } from '@/lib/portal/invite'
import { logAudit } from '@/lib/audit'

/**
 * Operator-side actions for the customer-portal invite flow. Owner /
 * chain_admin / manager only — clerks/techs/appraisers shouldn't be
 * able to grant portal access (it implies sending a magic link to an
 * email address that may not be verified).
 */

export type SendPortalInviteState = {
  ok?: boolean
  error?: string
  manualLink?: string | null
  delivered?: 'email' | 'manual'
}

export async function sendPortalInviteAction(
  _prev: SendPortalInviteState,
  formData: FormData,
): Promise<SendPortalInviteState> {
  const customerId = String(formData.get('customer_id') ?? '')
  if (!customerId) return { error: 'customer_id_missing' }

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) return { error: 'no_tenant' }

  const { userId } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
    'manager',
  ])

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (!appUrl) {
    return { error: 'app_url_not_configured' }
  }

  const result = await createPortalInvite({
    tenantId: ctx.tenantId,
    customerId,
    createdBy: userId,
    appUrl,
  })

  if (!result.ok) {
    return { error: result.reason }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'portal_invite_sent',
    tableName: 'customer_portal_invites',
    recordId: result.inviteId,
    changes: {
      customer_id: customerId,
      delivered: result.delivered,
      message_log_id: result.messageLogId,
    },
  })

  revalidatePath(`/customers/${customerId}`)

  return {
    ok: true,
    delivered: result.delivered,
    // When delivery fell back to manual, hand the operator the link so
    // they can text/call/email it themselves.
    manualLink: result.delivered === 'manual' ? result.magicLink : null,
  }
}

/**
 * Revoke an open invite — marks all unconsumed invites for a customer
 * as expired (we don't hard-delete so the audit trail stays intact).
 * Useful when the operator typo'd the email and wants to start over.
 */
export async function revokePortalInvitesAction(
  _prev: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const customerId = String(formData.get('customer_id') ?? '')
  if (!customerId) return { error: 'customer_id_missing' }

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) return { error: 'no_tenant' }

  const { userId, supabase } = await requireRoleInTenant(ctx.tenantId, [
    'owner',
    'chain_admin',
    'manager',
  ])

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()

  const nowIso = new Date().toISOString()
  const { data: revoked } = await admin
    .from('customer_portal_invites')
    .update({ expires_at: nowIso })
    .eq('customer_id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('id')

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'portal_invites_revoked',
    tableName: 'customer_portal_invites',
    recordId: customerId,
    changes: { revoked_count: revoked?.length ?? 0 },
  })

  // touch supabase to keep the import (used for type narrowing only).
  void supabase

  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}
