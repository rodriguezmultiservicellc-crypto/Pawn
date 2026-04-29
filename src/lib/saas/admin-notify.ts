import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendPlatformEmail } from '@/lib/email/platform'
import { formatCents } from './types'

/**
 * Platform-side notifications to RMS superadmins (not tenant owners —
 * those are dunning messages in lib/saas/dunning.ts).
 *
 * Recipients: every active profile with role='superadmin'. We resolve
 * email via auth.users (the only canonical source — profiles.email may
 * be null). Sent through the platform Resend account, NOT per-tenant
 * Resend.
 */

type Recipient = {
  authUserId: string
  email: string
  name: string | null
  language: 'en' | 'es'
}

export type NewTenantSignupArgs = {
  tenantId: string
  tenantName: string
  planName: string
  planCode: string
  cycle: 'monthly' | 'yearly'
  /** Stripe-reported amount in cents (per cycle). Optional. */
  amountCents?: number | null
  status: string
}

/**
 * Notify RMS superadmins that a new tenant has subscribed. Fires once
 * per tenant from the webhook handler (gated on "no prior tenant_
 * subscriptions row before this upsert").
 */
export async function sendNewTenantSignupNotification(
  args: NewTenantSignupArgs,
): Promise<{
  recipients: Array<{ authUserId: string; email: string; ok: boolean }>
}> {
  const recipients = await resolveSuperadmins()
  if (recipients.length === 0) {
    return { recipients: [] }
  }

  const results: Array<{ authUserId: string; email: string; ok: boolean }> =
    []

  for (const r of recipients) {
    const body = composeNewTenantBody(args, r)
    const send = await sendPlatformEmail({
      // Note: `tenantId` here is the SUBSCRIBING tenant — used for
      // message_log linkage. The actual recipient is the platform admin.
      tenantId: args.tenantId,
      to: r.email,
      subject: body.subject,
      html: body.html,
      text: body.text,
      // Reuse the saas_subscription_cancelled enum value? No — these are
      // operationally distinct. We don't have a dedicated kind for new
      // signups; use a benign placeholder + audit_log catches the real
      // signal. Reusing saas_payment_recovered would be misleading.
      // The right fix is a future migration adding 'saas_admin_new_tenant'
      // — for now we drop into 'custom' which is always available.
      kind: 'custom',
    })
    results.push({
      authUserId: r.authUserId,
      email: r.email,
      ok: send.ok,
    })
  }

  return { recipients: results }
}

async function resolveSuperadmins(): Promise<Recipient[]> {
  const admin = createAdminClient()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, language, full_name, role')
    .eq('role', 'superadmin')

  const ids = (profiles ?? []).map((p) => p.id)
  if (ids.length === 0) return []

  const out: Recipient[] = []
  for (const profile of profiles ?? []) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(profile.id)
      if (error || !data.user?.email) continue
      out.push({
        authUserId: profile.id,
        email: data.user.email,
        name: profile.full_name ?? null,
        language: profile.language === 'es' ? 'es' : 'en',
      })
    } catch {
      // ignore individual lookup failures
    }
  }
  return out
}

function composeNewTenantBody(
  args: NewTenantSignupArgs,
  r: Recipient,
): { subject: string; text: string; html: string } {
  const greeting = r.name
    ? r.language === 'es'
      ? `Hola ${r.name},`
      : `Hi ${r.name},`
    : r.language === 'es'
      ? 'Hola,'
      : 'Hi,'

  const amountStr =
    args.amountCents != null && args.amountCents > 0
      ? formatCents(args.amountCents)
      : null
  const amountSuffix =
    amountStr != null
      ? r.language === 'es'
        ? ` (${amountStr} / ${args.cycle === 'yearly' ? 'año' : 'mes'})`
        : ` (${amountStr} / ${args.cycle === 'yearly' ? 'year' : 'month'})`
      : ''

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const tenantsUrl = appUrl ? `${appUrl}/admin/tenants` : '/admin/tenants'
  const billingUrl = appUrl ? `${appUrl}/admin/billing` : '/admin/billing'

  if (r.language === 'es') {
    const subject = `Nuevo cliente Pawn: ${args.tenantName} (${args.planName})`
    const text = `${greeting}

Un nuevo inquilino se suscribió a Pawn.

Tenant:    ${args.tenantName}
Plan:      ${args.planName}${amountSuffix}
Ciclo:     ${args.cycle === 'yearly' ? 'anual' : 'mensual'}
Estado:    ${args.status}
Tenant ID: ${args.tenantId}

Consola admin:
${tenantsUrl}
${billingUrl}

— Pawn`
    const html = paragraphHtml(text)
    return { subject, text, html }
  }

  const subject = `New Pawn tenant: ${args.tenantName} (${args.planName})`
  const text = `${greeting}

A new tenant just subscribed to Pawn.

Tenant:    ${args.tenantName}
Plan:      ${args.planName}${amountSuffix}
Cycle:     ${args.cycle}
Status:    ${args.status}
Tenant ID: ${args.tenantId}

Admin console:
${tenantsUrl}
${billingUrl}

— Pawn`
  const html = paragraphHtml(text)
  return { subject, text, html }
}

function paragraphHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (m) => `<a href="${m}">${m}</a>`,
  )
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
  return `<!doctype html><html><body>${paragraphs}</body></html>`
}
