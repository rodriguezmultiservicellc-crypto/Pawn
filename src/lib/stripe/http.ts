/**
 * Stripe REST transport shared by every server-side Stripe module
 * (terminal.ts, payment-link.ts, saas.ts, connect.ts).
 *
 * We deliberately do not depend on the `stripe` npm SDK: the surface we
 * use is small, form-encoded, and this keeps the Node + Edge story simple.
 *
 *   - Platform calls: omit `accountId`.
 *   - Connected-account calls (Terminal, Checkout on a tenant's account):
 *     pass `accountId` and it goes out as the Stripe-Account header.
 *   - `idempotencyKey` is forwarded as Idempotency-Key for retry-safe POSTs.
 *   - `null` / `undefined` body values are skipped so callers can build
 *     bodies with optional fields without pruning them first.
 *
 * ENV: STRIPE_SECRET_KEY (platform secret key). Throws
 * 'stripe_secret_key_missing' when unset — surfaced by the action layer.
 */

import 'server-only'

export const STRIPE_API_BASE = 'https://api.stripe.com/v1'

export type StripeFormValue = string | number | boolean | undefined | null
export type StripeFormBody = Record<string, StripeFormValue>

export function stripeSecretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY
  if (!k) throw new Error('stripe_secret_key_missing')
  return k
}

export function encodeForm(body: StripeFormBody): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue
    params.append(k, String(v))
  }
  return params.toString()
}

export async function stripeFetch<T>(
  path: string,
  init: {
    method: 'POST' | 'GET' | 'DELETE'
    body?: StripeFormBody
    /** Connected account to act on (Stripe-Account header). */
    accountId?: string
    /** Optional Idempotency-Key header for retry safety on POSTs. */
    idempotencyKey?: string
  },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeSecretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (init.accountId) headers['Stripe-Account'] = init.accountId
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body ? encodeForm(init.body) : undefined,
    cache: 'no-store',
  })
  const json = (await res.json()) as unknown
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message ??
      `stripe_http_${res.status}`
    throw new Error(msg)
  }
  return json as T
}
