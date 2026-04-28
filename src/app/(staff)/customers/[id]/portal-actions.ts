'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
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
  /** Underlying provider/error message for owner-facing diagnostics. */
  details?: string | null
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

  const appUrl = await resolveAppUrl()
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
    return { error: result.reason, details: result.error ?? null }
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

/**
 * Resolve the absolute base URL the magic-link should redirect back to.
 *
 * Order of preference:
 *   1. NEXT_PUBLIC_APP_URL env (canonical — set this in Vercel for
 *      production reliability).
 *   2. The current request's host + protocol (Vercel's auto-injected
 *      x-forwarded-* headers). Saves the operator from a misconfigured
 *      build when the env var is missing or stale (e.g. baked at build
 *      time pointing at localhost from .env.local).
 *   3. VERCEL_URL (Vercel runtime) as a last resort.
 *
 * Returns '' when nothing resolves — caller should treat that as an
 * error rather than building a relative URL.
 */
async function resolveAppUrl(): Promise<string> {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (fromEnv && !fromEnv.includes('localhost')) {
    return fromEnv
  }

  // Header-derived fallback. Headers are awaited in Next 15+.
  try {
    const h = await headers()
    const host =
      h.get('x-forwarded-host') ?? h.get('host') ?? ''
    const proto =
      h.get('x-forwarded-proto') ??
      (host.includes('localhost') ? 'http' : 'https')
    if (host) return `${proto}://${host}`.replace(/\/$/, '')
  } catch {
    // headers() throws outside a request context — fall through.
  }

  // Last resort: Vercel-injected runtime env.
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/$/, '')

  // Localhost env fallback (dev only) — only if it really is the dev URL.
  if (fromEnv) return fromEnv
  return ''
}
