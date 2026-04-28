'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { renderPortalInviteEmail } from '@/lib/portal/invite-email'

/**
 * Portal sign-in via magic link. Customer-side action.
 *
 * Security posture: NEVER reveal whether an email is in the system.
 * Always returns ok:true after handling. Internally:
 *   - Look up the customer record by email (admin client).
 *   - If found AND has auth_user_id, mint a magic-link via
 *     admin.auth.admin.generateLink({type:'magiclink'}) — only works
 *     for existing auth users.
 *   - Send via per-tenant Resend, falling back to no-op (silent) if
 *     not configured. The customer learns "check your email" either
 *     way; if their account doesn't exist or Resend isn't wired
 *     they just won't see anything in their inbox.
 *
 * Returns ok:true on every code path that doesn't throw, so a script-
 * kiddie can't enumerate emails by timing or response shape.
 */
export type PortalLoginState = {
  ok?: boolean
  error?: string
}

export async function requestPortalLoginAction(
  _prev: PortalLoginState,
  formData: FormData,
): Promise<PortalLoginState> {
  const rawEmail = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return { error: 'invalid_email' }
  }

  const admin = createAdminClient()

  // Find a customer record with this email + a portal account linked.
  // If the email has rows in multiple tenants we just use the most
  // recently-created one (multi-shop portal customers are out of scope
  // for v1).
  type CustomerLite = {
    id: string
    tenant_id: string
    first_name: string
    last_name: string
    email: string
    language: 'en' | 'es' | null
    auth_user_id: string | null
  }
  const { data: rows } = await admin
    .from('customers')
    .select('id, tenant_id, first_name, last_name, email, language, auth_user_id')
    .ilike('email', rawEmail)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const customer = ((rows ?? [])[0] ?? null) as CustomerLite | null

  // Hide existence: always return ok:true. If we have nothing to send,
  // exit silently. Avoid awaiting heavy work either side so the timing
  // is comparable.
  if (!customer || !customer.auth_user_id) {
    return { ok: true }
  }

  const appUrl = await resolveAppUrl()
  if (!appUrl) {
    // Misconfigured server — surface so it gets fixed (the operator
    // hits this, not the customer; security trade-off accepted).
    console.error('[portal.login] resolveAppUrl returned empty')
    return { error: 'app_url_not_configured' }
  }
  const next = '/api/portal/sign-in-bridge'
  const redirectTo = `${appUrl}/magic-link?next=${encodeURIComponent(next)}`

  // Mint the magic link (existing user only — type='magiclink').
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
      console.error('[portal.login] generateLink error', resp.error.message)
      return { ok: true } // silent
    }
    const link = resp.data?.properties?.action_link
    if (!link) {
      console.error('[portal.login] generateLink missing action_link')
      return { ok: true }
    }
    actionLink = link
  } catch (err) {
    console.error('[portal.login] generateLink threw', err)
    return { ok: true }
  }

  // Send via per-tenant Resend. Reuse the invite-email renderer (same
  // copy works for "sign in to your portal" — both are "click this link
  // to access").
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
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
  })

  // Fire and forget — we don't want to block the response on Resend
  // latency, and we already returned a generic ok regardless.
  void sendEmail({
    tenantId: customer.tenant_id,
    to: customer.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'portal_invite',
    customerId: customer.id,
  })

  return { ok: true }
}

async function resolveAppUrl(): Promise<string> {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (fromEnv && !fromEnv.includes('localhost')) {
    return fromEnv
  }
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
