/**
 * Template-rendering primitives shared by SMS, WhatsApp, and email.
 *
 * - {{var}} mustache-style replacement, no dependency.
 * - HTML escaping for the email channel only — SMS / WhatsApp pass through
 *   raw text. Variables are escaped, but the surrounding template body is
 *   trusted (staff-authored).
 * - For email, we synthesize a minimal HTML wrapper from the same body
 *   (paragraph-per-blank-line, single newlines become <br/>). This keeps
 *   the templates editor as a single textarea without forcing the staff
 *   to maintain a parallel HTML version.
 */

import 'server-only'

export type RenderVars = Record<string, string | number | null | undefined>

/** Mustache-style {{key}} replacement. Missing keys render as empty string. */
export function renderTemplate(
  body: string,
  vars: RenderVars,
  opts: { escapeHtml?: boolean } = {},
): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const raw = vars[key]
    if (raw == null) return ''
    const s = String(raw)
    return opts.escapeHtml ? escapeHtml(s) : s
  })
}

/** Subject + body renderer for email. Returns text + minimal HTML. */
export function renderEmailTemplate(args: {
  subject: string | null
  body: string
  vars: RenderVars
}): { subject: string; text: string; html: string } {
  const subject = renderTemplate(args.subject ?? '', args.vars).trim()
  const text = renderTemplate(args.body, args.vars)
  const html = textToSimpleHtml(renderTemplate(args.body, args.vars, { escapeHtml: true }))
  return { subject, text, html }
}

/** Conservative HTML escape — covers <, >, &, ", '. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Convert plain text to a minimal HTML body. Blank lines become paragraph
 * breaks; single newlines become <br/>. Wraps in a <div> with system-font
 * styling so most clients render it consistently. The body MUST already
 * be HTML-escaped (we receive it from renderTemplate with escapeHtml).
 */
export function textToSimpleHtml(escapedBody: string): string {
  const paragraphs = escapedBody
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, '<br/>'))
    .map((p) => `<p style="margin:0 0 12px 0;">${p}</p>`)
    .join('')
  return `<div style="font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#222222;">${paragraphs}</div>`
}
