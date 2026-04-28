import 'server-only'
import { textToSimpleHtml, escapeHtml } from '@/lib/comms/render'

/**
 * Built-in (non-tenant-editable) bilingual portal-invite email.
 *
 * We don't route this through message_templates because portal invites
 * are infrastructure: every shop sends them, the wording barely matters,
 * and we don't want a "you forgot to set up your invite template" failure
 * mode blocking onboarding. Operators can still see the message_log row
 * (kind='portal_invite') for audit.
 */

export type RenderArgs = {
  language: 'en' | 'es'
  shopName: string
  customerName: string
  magicLink: string
  expiresAt: Date
  /** Optional — if provided, the email tells the customer where to
   *  sign in next time (after the magic-link expires). Defaults to
   *  omitting the line entirely. */
  signInUrl?: string | null
}

export function renderPortalInviteEmail(args: RenderArgs): {
  subject: string
  text: string
  html: string
} {
  const expiresLabel = args.expiresAt.toLocaleDateString(
    args.language === 'es' ? 'es-ES' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  )

  const greeting = args.customerName.trim()
    ? args.language === 'es'
      ? `Hola ${args.customerName},`
      : `Hi ${args.customerName},`
    : args.language === 'es'
      ? 'Hola,'
      : 'Hi,'

  const subject =
    args.language === 'es'
      ? `Acceso al portal de clientes — ${args.shopName}`
      : `Customer portal access — ${args.shopName}`

  const signInLineEs = args.signInUrl
    ? `\n\nLa próxima vez, inicie sesión aquí: ${args.signInUrl}`
    : ''
  const signInLineEn = args.signInUrl
    ? `\n\nNext time, sign in here: ${args.signInUrl}`
    : ''

  const bodyEs = `${greeting}

${args.shopName} le ha invitado a acceder al portal de clientes. En el portal podrá:

- ver el saldo y la fecha de vencimiento de sus préstamos
- consultar el estado de sus reparaciones
- ver el saldo de sus apartados (layaways)

Para acceder, haga clic en el siguiente enlace:

${args.magicLink}

Este enlace caduca el ${expiresLabel}. Si no solicitó este acceso, puede ignorar este correo.${signInLineEs}

— ${args.shopName}`

  const bodyEn = `${greeting}

${args.shopName} has invited you to the customer portal. From the portal you can:

- See your loan balances and due dates
- Check the status of your repairs
- View your layaway balances

To get started, click the link below:

${args.magicLink}

This link expires on ${expiresLabel}. If you didn't request this access, you can ignore this email.${signInLineEn}

— ${args.shopName}`

  const text = args.language === 'es' ? bodyEs : bodyEn
  // For HTML we want the magic link as a real anchor, not just text. Build
  // it from escaped pieces so user-supplied fields (shop name, customer
  // name) can't inject markup.
  const escName = escapeHtml(args.customerName)
  const escShop = escapeHtml(args.shopName)
  const escExpires = escapeHtml(expiresLabel)
  const escLink = escapeHtml(args.magicLink)

  const buttonStyle =
    'display:inline-block;padding:12px 20px;background:#FF385C;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;'

  const greetingHtml = escName
    ? args.language === 'es'
      ? `Hola ${escName},`
      : `Hi ${escName},`
    : args.language === 'es'
      ? 'Hola,'
      : 'Hi,'

  const introHtml =
    args.language === 'es'
      ? `${escShop} le ha invitado a acceder al portal de clientes. Desde el portal podrá ver sus préstamos, reparaciones y apartados.`
      : `${escShop} has invited you to the customer portal. From the portal you can see your loans, repairs, and layaways.`

  const buttonLabel =
    args.language === 'es' ? 'Acceder al portal' : 'Open the portal'

  const fineprintHtml =
    args.language === 'es'
      ? `Este enlace caduca el ${escExpires}. Si no solicitó este acceso, puede ignorar este correo.`
      : `This link expires on ${escExpires}. If you didn't request this access, you can ignore this email.`

  const escSignIn = args.signInUrl ? escapeHtml(args.signInUrl) : ''
  const signInHtml = args.signInUrl
    ? args.language === 'es'
      ? `<p style="margin:0 0 16px 0;font-size:12px;color:#717171;">La próxima vez, inicie sesión aquí: <a href="${escSignIn}" style="color:#222222;">${escSignIn}</a></p>`
      : `<p style="margin:0 0 16px 0;font-size:12px;color:#717171;">Next time, sign in here: <a href="${escSignIn}" style="color:#222222;">${escSignIn}</a></p>`
    : ''

  const inner = `<p style="margin:0 0 16px 0;">${greetingHtml}</p>
<p style="margin:0 0 16px 0;">${introHtml}</p>
<p style="margin:0 0 24px 0;"><a href="${escLink}" style="${buttonStyle}">${buttonLabel}</a></p>
<p style="margin:0 0 16px 0;font-size:12px;color:#717171;">${fineprintHtml}</p>${signInHtml}
<p style="margin:24px 0 0 0;font-size:12px;color:#717171;">— ${escShop}</p>`

  // Wrap in the same outer container textToSimpleHtml uses, so the email
  // looks consistent with operator-edited templates.
  const html = `<div style="font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#222222;">${inner}</div>`

  return { subject, text, html }
}

// Keep textToSimpleHtml in the module's import graph so devs see the
// link to the canonical email-rendering helper. We don't actually call
// it here because we want a real HTML anchor for the CTA.
void textToSimpleHtml
