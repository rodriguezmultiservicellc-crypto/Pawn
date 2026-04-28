import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { renderPortalInviteEmail } from './invite-email'

/**
 * Customer-portal invite issuance + magic-link generation.
 *
 * The flow has three actors: the operator (clicks "Send portal invite"),
 * Supabase Auth (mints the OTP magic link), and the customer (clicks +
 * lands on /portal/claim/<token>).
 *
 * We do NOT use Supabase's built-in email sending — per Phase 5 gotchas
 * the SMTP path was unreliable and we want the brand to look like the
 * shop's, not Supabase's. Instead we mint the magic link via
 * admin.generateLink({type: 'invite', ...}) and send via per-tenant
 * Resend. Falls back to returning the link to the operator if Resend
 * isn't configured for the tenant yet — they can copy + paste.
 */

const INVITE_TTL_DAYS = 7

export type PortalInviteResult =
  | {
      ok: true
      inviteId: string
      token: string
      magicLink: string
      delivered: 'email' | 'manual'
      messageLogId: string | null
    }
  | {
      ok: false
      reason:
        | 'no_email'
        | 'already_linked'
        | 'auth_invite_failed'
        | 'invite_insert_failed'
      error: string | null
    }

export async function createPortalInvite(args: {
  tenantId: string
  customerId: string
  createdBy: string
  appUrl: string
}): Promise<PortalInviteResult> {
  const admin = createAdminClient()

  const { data: customer, error: cErr } = await admin
    .from('customers')
    .select(
      'id, tenant_id, first_name, last_name, email, language, auth_user_id, deleted_at',
    )
    .eq('id', args.customerId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()

  if (cErr || !customer || customer.deleted_at) {
    return { ok: false, reason: 'no_email', error: cErr?.message ?? 'customer_not_found' }
  }
  if (!customer.email || !customer.email.trim()) {
    return { ok: false, reason: 'no_email', error: null }
  }
  if (customer.auth_user_id) {
    return { ok: false, reason: 'already_linked', error: null }
  }

  const { data: tenant } = await admin
    .from('tenants')
    .select('name, dba')
    .eq('id', args.tenantId)
    .maybeSingle<{ name: string; dba: string | null }>()

  const shopName = tenant?.dba || tenant?.name || 'your shop'

  // 1. Persist the invite token row first (we own the bookkeeping).
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
  const { data: inviteRow, error: insErr } = await admin
    .from('customer_portal_invites')
    .insert({
      tenant_id: args.tenantId,
      customer_id: args.customerId,
      email: customer.email,
      expires_at: expires.toISOString(),
      created_by: args.createdBy,
    })
    .select('id, token')
    .single()

  if (insErr || !inviteRow) {
    return {
      ok: false,
      reason: 'invite_insert_failed',
      error: insErr?.message ?? 'invite_insert_failed',
    }
  }

  const claimPath = `/portal/claim/${inviteRow.token}`
  const redirectTo = `${args.appUrl}/magic-link?next=${encodeURIComponent(
    claimPath,
  )}`

  // 2. Ask Supabase Auth to mint a magic link. We try `type: 'invite'`
  //    first (creates the auth.users row when missing — perfect for
  //    first-time portal users). If that fails because the user already
  //    exists in auth.users (e.g. operator is testing with their own
  //    email, or the customer was previously invited under a different
  //    customer record), fall back to `type: 'magiclink'` which works
  //    for existing users.
  type GenerateLinkResp = {
    properties?: { action_link?: string }
    data?: { properties?: { action_link?: string } }
  }
  type GenerateLinkResult = {
    data: GenerateLinkResp
    error: { message: string; status?: number } | null
  }

  const isAlreadyRegistered = (msg: string): boolean => {
    const lower = msg.toLowerCase()
    return (
      lower.includes('already') ||
      lower.includes('registered') ||
      lower.includes('exists')
    )
  }

  const tryGenerate = async (
    type: 'invite' | 'magiclink',
  ): Promise<GenerateLinkResult> => {
    return (await admin.auth.admin.generateLink({
      type,
      email: customer.email!,
      options: { redirectTo },
    })) as unknown as GenerateLinkResult
  }

  let magicLink: string
  try {
    let resp = await tryGenerate('invite')

    if (resp.error && isAlreadyRegistered(resp.error.message)) {
      console.warn(
        '[portal.invite] invite said user exists, retrying as magiclink',
        { email: customer.email, originalError: resp.error.message },
      )
      resp = await tryGenerate('magiclink')
    }

    if (resp.error) {
      console.error('[portal.invite] generateLink error', {
        message: resp.error.message,
        status: resp.error.status,
        email: customer.email,
        redirectTo,
      })
      return {
        ok: false,
        reason: 'auth_invite_failed',
        error: resp.error.message,
      }
    }
    const link =
      resp.data?.properties?.action_link ??
      resp.data?.data?.properties?.action_link
    if (!link) {
      console.error('[portal.invite] generateLink missing action_link', {
        respKeys: resp.data ? Object.keys(resp.data) : null,
      })
      return {
        ok: false,
        reason: 'auth_invite_failed',
        error: 'generateLink missing action_link',
      }
    }
    magicLink = link
  } catch (err) {
    console.error('[portal.invite] generateLink threw', err)
    return {
      ok: false,
      reason: 'auth_invite_failed',
      error: err instanceof Error ? err.message : 'generateLink threw',
    }
  }

  // 3. Try to send via per-tenant Resend. Fall back to manual delivery.
  const customerName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  const language: 'en' | 'es' =
    customer.language === 'es' ? 'es' : 'en'

  const rendered = renderPortalInviteEmail({
    language,
    shopName,
    customerName,
    magicLink,
    expiresAt: expires,
  })

  const sendResult = await sendEmail({
    tenantId: args.tenantId,
    to: customer.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'portal_invite',
    customerId: customer.id,
  })

  return {
    ok: true,
    inviteId: inviteRow.id,
    token: inviteRow.token,
    magicLink,
    delivered: sendResult.ok ? 'email' : 'manual',
    messageLogId: sendResult.ok
      ? sendResult.messageLogId
      : sendResult.messageLogId,
  }
}

/**
 * Resolve + consume an invite. Returns null when the token doesn't
 * exist, has expired, or has already been consumed. Caller is
 * responsible for binding the auth.users row to the customer + creating
 * the user_tenants(role='client') membership AFTER this returns
 * successfully — `consume` only marks the invite row.
 */
export async function consumePortalInvite(args: {
  token: string
  consumedBy: string
}): Promise<{
  inviteId: string
  tenantId: string
  customerId: string
  email: string
} | null> {
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('customer_portal_invites')
    .select('id, tenant_id, customer_id, email, expires_at, consumed_at')
    .eq('token', args.token)
    .maybeSingle()

  if (!invite) return null
  if (invite.consumed_at) return null
  if (new Date(invite.expires_at).getTime() < Date.now()) return null

  const { error: updErr } = await admin
    .from('customer_portal_invites')
    .update({
      consumed_at: new Date().toISOString(),
      consumed_by: args.consumedBy,
    })
    .eq('id', invite.id)

  if (updErr) return null

  return {
    inviteId: invite.id,
    tenantId: invite.tenant_id,
    customerId: invite.customer_id,
    email: invite.email,
  }
}
