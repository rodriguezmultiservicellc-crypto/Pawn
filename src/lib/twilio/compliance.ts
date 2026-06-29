/**
 * Pure SMS compliance helpers — no server-only / Supabase imports, so this
 * stays unit-testable under vitest. Re-exported from ./core for callers.
 */

const COMPLIANCE_FOOTER = '\n\nReply STOP to unsubscribe. Msg&Data Rates may apply.'

/**
 * Append the TCPA opt-out footer to an SMS body. Idempotent — skips if the
 * body already mentions a STOP instruction (so a resend never double-stacks
 * it). SMS only; WhatsApp templates carry their own Meta-mandated opt-out
 * and in-session freeform doesn't need it (the customer started the thread).
 */
export function withComplianceFooter(body: string): string {
  if (!body) return body
  if (/reply\s+stop/i.test(body)) return body
  return body + COMPLIANCE_FOOTER
}
