import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * orocut.com webhook signature: `X-OroCut-Signature: sha256=<HMAC-SHA256 of
 * the raw body, keyed with the token's webhook secret (whsec_…)>`. The live
 * server sends hex (lib/licensing/orders.ts, signWebhookBody); base64 is
 * accepted too because constant-time comparing against both costs nothing.
 */
export function verifyOrocutSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false
  const m = /^\s*sha256=([A-Za-z0-9+/=_-]+)\s*$/.exec(header)
  if (!m) return false
  const provided = m[1]
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest()

  const candidates: Buffer[] = []
  if (/^[0-9a-fA-F]+$/.test(provided) && provided.length === expected.length * 2) {
    candidates.push(Buffer.from(provided, 'hex'))
  }
  try {
    const b64 = Buffer.from(provided.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (b64.length === expected.length) candidates.push(b64)
  } catch {
    // not base64 — fall through
  }
  return candidates.some((c) => c.length === expected.length && timingSafeEqual(c, expected))
}

/** Hex signature header value for a body — used by the tests and the local mock. */
export function signOrocutBody(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}
