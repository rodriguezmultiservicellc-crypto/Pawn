/**
 * Pure SMS compliance helpers — no server-only / Supabase imports, so this
 * stays unit-testable under vitest. Re-exported from ./core for callers.
 */

const COMPLIANCE_FOOTER = {
  en: '\n\nReply STOP to unsubscribe. Msg&Data Rates may apply.',
  es: '\n\nResponda STOP para cancelar. Pueden aplicar tarifas de mensajes y datos.',
} as const

/**
 * Append the TCPA opt-out footer to an SMS body, in the customer's
 * language. Idempotent — skips if the body already carries a STOP
 * instruction in either language (so a resend never double-stacks it).
 * SMS only; WhatsApp templates carry their own Meta-mandated opt-out and
 * in-session freeform doesn't need it (the customer started the thread).
 */
export function withComplianceFooter(
  body: string,
  language: 'en' | 'es' = 'en',
): string {
  if (!body) return body
  if (/(reply|responda|responde)\s+stop/i.test(body)) return body
  return body + COMPLIANCE_FOOTER[language]
}
