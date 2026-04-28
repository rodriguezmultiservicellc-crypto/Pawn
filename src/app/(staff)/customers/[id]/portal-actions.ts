'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createPortalInvite } from '@/lib/portal/invite'
import { renderPortalInviteEmail } from '@/lib/portal/invite-email'
import { sendEmail } from '@/lib/email/send'
import { createAdminClient } from '@/lib/supabase/admin'
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

export type GenerateSignInLinkState = {
  ok?: boolean
  error?: string
  details?: string | null
  /** The fresh magic-link URL — owner copies + sends to the customer
   *  (in-store assist when they forgot their email or the original
   *  invite expired). Always returned alongside email-delivery
   *  attempt; the operator chooses whichever channel works. */
  magicLink?: string | null
  /** Whether sendEmail succeeded — UI shows "emailed too" when true. */
  emailed?: boolean
}

/**
 * Mint a fresh sign-in magic link for an ALREADY-CLAIMED portal
 * customer. Use case: customer is at the counter, forgot which email
 * the portal is on, or the original invite expired and a friction-
 * free re-link is faster than walking them through /portal/login.
 *
 * Owner / chain_admin / manager only — same gating as send/revoke
 * invites. Always returns the link to the operator AND attempts to
 * email it via per-tenant Resend; the operator picks whichever channel
 * works for the customer in front of them.
 */
export async function generatePortalSignInLinkAction(
  _prev: GenerateSignInLinkState,
  formData: FormData,
): Promise<GenerateSignInLinkState> {
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

  const admin = createAdminClient()

  type CustomerRow = {
    id: string
    tenant_id: string
    first_name: string
    last_name: string
    email: string | null
    language: 'en' | 'es' | null
    auth_user_id: string | null
    deleted_at: string | null
  }
  const { data: customer } = await admin
    .from('customers')
    .select(
      'id, tenant_id, first_name, last_name, email, language, auth_user_id, deleted_at',
    )
    .eq('id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle<CustomerRow>()

  if (!customer || customer.deleted_at) {
    return { error: 'customer_not_found' }
  }
  if (!customer.email) {
    return { error: 'no_email' }
  }
  if (!customer.auth_user_id) {
    // They've never claimed — the operator should send a regular invite,
    // not a sign-in link. Surface the right next step.
    return { error: 'not_yet_claimed' }
  }

  const appUrl = await resolveAppUrl()
  if (!appUrl) return { error: 'app_url_not_configured' }
  const next = '/api/portal/sign-in-bridge'
  const redirectTo = `${appUrl}/magic-link?next=${encodeURIComponent(next)}`

  type GenLinkResp = {
    data?: { properties?: { action_link?: string } }
    error?: { message?: string } | null
  }
  let actionLink: string
  try {
    const resp = (await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: customer.email,
      options: { redirectTo },
    })) as unknown as GenLinkResp
    if (resp.error) {
      console.error(
        '[portal.signin-link] generateLink error',
        resp.error.message,
      )
      return {
        error: 'auth_link_failed',
        details: resp.error.message ?? null,
      }
    }
    const link = resp.data?.properties?.action_link
    if (!link) {
      return {
        error: 'auth_link_failed',
        details: 'generateLink returned no action_link',
      }
    }
    actionLink = link
  } catch (err) {
    console.error('[portal.signin-link] generateLink threw', err)
    return {
      error: 'auth_link_failed',
      details: err instanceof Error ? err.message : 'generateLink threw',
    }
  }

  // Best-effort email through per-tenant Resend. Whether or not it
  // succeeds, we hand the link back to the operator so they can SMS /
  // text / read it to the customer in front of them.
  const { data: tenant } = await admin
    .from('tenants')
    .select('name, dba')
    .eq('id', customer.tenant_id)
    .maybeSingle<{ name: string; dba: string | null }>()
  const shopName = tenant?.dba || tenant?.name || 'your shop'
  const customerName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  const language: 'en' | 'es' = customer.language === 'es' ? 'es' : 'en'

  const rendered = renderPortalInviteEmail({
    language,
    shopName,
    customerName,
    magicLink: actionLink,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    signInUrl: `${appUrl}/portal/login`,
  })

  const emailRes = await sendEmail({
    tenantId: customer.tenant_id,
    to: customer.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'portal_invite',
    customerId: customer.id,
  })

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'portal_invite_sent',
    tableName: 'customers',
    recordId: customer.id,
    changes: {
      kind: 'sign_in_link',
      emailed: emailRes.ok,
      message_log_id: emailRes.ok ? emailRes.messageLogId : null,
    },
  })

  revalidatePath(`/customers/${customerId}`)

  return {
    ok: true,
    magicLink: actionLink,
    emailed: emailRes.ok,
  }
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
