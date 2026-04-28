import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendPlatformEmail } from '@/lib/email/platform'
import { formatCents } from './types'

/**
 * Dunning kinds. These are the four message_kind enum values added by
 * patches/0016-saas-dunning-message-kinds.sql for platform→tenant-owner
 * messaging (RMS reaching out about subscription state, not tenant→
 * customer comms).
 */
export type DunningKind =
  | 'saas_trial_ending'
  | 'saas_payment_failed'
  | 'saas_payment_recovered'
  | 'saas_subscription_cancelled'

type Recipient = {
  authUserId: string
  email: string
  language: 'en' | 'es'
  name: string | null
}

type TenantContext = {
  tenantId: string
  tenantName: string
}

type EmailBody = { subject: string; html: string; text: string }

/**
 * Send a dunning email to every active owner / chain_admin of a tenant.
 * Looks up auth.users.email via the service-role client (the only way to
 * reach auth user emails — RLS on profiles doesn't expose email by
 * default, and even profiles.email may be null in some setups).
 *
 * Each owner gets ONE email per kind per call. The platform Resend
 * account sends the message; per-tenant Resend creds are NOT used here
 * (this is RMS reaching out, not the tenant reaching out to its
 * customers).
 *
 * Returns a per-recipient result so the webhook handler can surface a
 * summary in audit_log.
 */
export async function sendDunningEmail(args: {
  tenantId: string
  kind: DunningKind
  vars?: Record<string, string | number | null>
}): Promise<
  Array<{
    authUserId: string
    email: string
    ok: boolean
    reason?: string
  }>
> {
  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, dba')
    .eq('id', args.tenantId)
    .maybeSingle()
  if (!tenant) return []

  const tenantCtx: TenantContext = {
    tenantId: tenant.id,
    tenantName: tenant.dba ?? tenant.name,
  }

  const recipients = await resolveOwnerRecipients(args.tenantId)
  if (recipients.length === 0) return []

  const results: Array<{
    authUserId: string
    email: string
    ok: boolean
    reason?: string
  }> = []

  for (const r of recipients) {
    const body = composeBody(args.kind, r.language, tenantCtx, r, args.vars ?? {})
    const send = await sendPlatformEmail({
      tenantId: args.tenantId,
      to: r.email,
      subject: body.subject,
      html: body.html,
      text: body.text,
      kind: args.kind,
    })
    results.push({
      authUserId: r.authUserId,
      email: r.email,
      ok: send.ok,
      reason: send.ok ? undefined : send.reason,
    })
  }

  return results
}

async function resolveOwnerRecipients(tenantId: string): Promise<Recipient[]> {
  const admin = createAdminClient()

  // Active owner / chain_admin members of this tenant.
  const { data: memberships } = await admin
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .in('role', ['owner', 'chain_admin'])

  const userIds = (memberships ?? []).map((m) => m.user_id)
  if (userIds.length === 0) return []

  // profiles.language is our source of truth for locale preference.
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, language, full_name')
    .in('id', userIds)
  const profileById = new Map<
    string,
    { language: string | null; full_name: string | null }
  >()
  for (const p of profiles ?? []) {
    profileById.set(p.id, {
      language: p.language ?? null,
      full_name: p.full_name ?? null,
    })
  }

  // auth.users.email — service-role only.
  const out: Recipient[] = []
  for (const uid of userIds) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(uid)
      if (error || !data.user?.email) continue
      const prof = profileById.get(uid)
      const language: 'en' | 'es' = prof?.language === 'es' ? 'es' : 'en'
      out.push({
        authUserId: uid,
        email: data.user.email,
        language,
        name: prof?.full_name ?? null,
      })
    } catch {
      // ignore — single failure shouldn't block the rest
    }
  }
  return out
}

function composeBody(
  kind: DunningKind,
  lang: 'en' | 'es',
  tenant: TenantContext,
  recipient: Recipient,
  vars: Record<string, string | number | null>,
): EmailBody {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const billingUrl = appUrl ? `${appUrl}/billing` : '/billing'
  const greeting = recipient.name
    ? lang === 'es'
      ? `Hola ${recipient.name},`
      : `Hi ${recipient.name},`
    : lang === 'es'
      ? 'Hola,'
      : 'Hi there,'

  const trialDays = num(vars.trial_days)
  const amountCents = num(vars.amount_cents)
  const amountStr = amountCents != null ? formatCents(amountCents) : null

  switch (kind) {
    case 'saas_trial_ending': {
      const daysCopy =
        trialDays != null
          ? lang === 'es'
            ? `en ${trialDays} día${trialDays === 1 ? '' : 's'}`
            : `in ${trialDays} day${trialDays === 1 ? '' : 's'}`
          : lang === 'es'
            ? 'pronto'
            : 'soon'

      if (lang === 'es') {
        const subject = `Tu período de prueba de ${tenant.tenantName} termina ${daysCopy}`
        const text = `${greeting}

Tu período de prueba de Pawn termina ${daysCopy}. Para evitar interrupciones, agrega un método de pago en:

${billingUrl}

Si tienes preguntas, responde a este correo.

— El equipo de Pawn`
        const html = paragraphHtml(text)
        return { subject, html, text }
      }
      const subject = `Your ${tenant.tenantName} trial ends ${daysCopy}`
      const text = `${greeting}

Your Pawn trial ends ${daysCopy}. Add a payment method to keep your subscription active:

${billingUrl}

If you have any questions, just reply to this email.

— The Pawn team`
      const html = paragraphHtml(text)
      return { subject, html, text }
    }

    case 'saas_payment_failed': {
      const amountCopy = amountStr
        ? lang === 'es'
          ? ` por ${amountStr}`
          : ` for ${amountStr}`
        : ''
      if (lang === 'es') {
        const subject = `Problema con el pago de tu suscripción${amountCopy}`
        const text = `${greeting}

No pudimos procesar tu pago de suscripción${amountCopy}. Esto puede ser una tarjeta vencida o fondos insuficientes. Por favor actualiza tu método de pago en:

${billingUrl}

Stripe volverá a intentar el cobro automáticamente en los próximos días. Si el cobro sigue fallando, tu suscripción quedará en estado vencido y algunas funciones podrían restringirse.

— El equipo de Pawn`
        const html = paragraphHtml(text)
        return { subject, html, text }
      }
      const subject = `Payment failed on your subscription${amountCopy}`
      const text = `${greeting}

We couldn't process your subscription payment${amountCopy}. This can happen with an expired card or insufficient funds. Please update your payment method here:

${billingUrl}

Stripe will retry automatically over the next few days. If payment keeps failing, your subscription will move to past_due and some features may be restricted.

— The Pawn team`
      const html = paragraphHtml(text)
      return { subject, html, text }
    }

    case 'saas_payment_recovered': {
      if (lang === 'es') {
        const subject = `Pago recibido — gracias`
        const text = `${greeting}

Recibimos tu pago de suscripción${amountStr ? ` por ${amountStr}` : ''}. Tu cuenta vuelve al estado activo. Gracias por seguir con nosotros.

— El equipo de Pawn`
        const html = paragraphHtml(text)
        return { subject, html, text }
      }
      const subject = `Payment received — thanks`
      const text = `${greeting}

We received your subscription payment${amountStr ? ` of ${amountStr}` : ''}. Your account is back to active. Thanks for sticking with us.

— The Pawn team`
      const html = paragraphHtml(text)
      return { subject, html, text }
    }

    case 'saas_subscription_cancelled': {
      if (lang === 'es') {
        const subject = `Suscripción cancelada`
        const text = `${greeting}

Tu suscripción de Pawn ha sido cancelada. Tus datos quedan accesibles en modo de solo lectura. Si quieres reactivar tu cuenta:

${billingUrl}

— El equipo de Pawn`
        const html = paragraphHtml(text)
        return { subject, html, text }
      }
      const subject = `Subscription cancelled`
      const text = `${greeting}

Your Pawn subscription has been cancelled. Your data stays accessible in read-only mode. If you'd like to reactivate:

${billingUrl}

— The Pawn team`
      const html = paragraphHtml(text)
      return { subject, html, text }
    }
  }
}

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function paragraphHtml(text: string): string {
  // Minimal HTML — text-first, paragraphs from blank lines, links auto-
  // wrapped. No inline styles since most clients ignore them anyway and
  // dunning emails should look plain by design.
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
