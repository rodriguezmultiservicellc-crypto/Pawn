/**
 * Stripe REST helpers for the SaaS-billing surface.
 *
 * SCOPE:
 *   These helpers run AGAINST THE PLATFORM ACCOUNT (RMS itself), NOT
 *   against per-tenant Connect accounts. Used to:
 *     - Provision / update one Stripe Product per app plan (basic / pro /
 *       chain) and one Stripe Price per (product × cycle).
 *     - Create a Stripe Customer for each tenant when they first upgrade.
 *     - Open a Subscription Checkout Session redirecting the tenant owner
 *       to Stripe-hosted plan selection.
 *
 *   For per-tenant Connect (Terminal + Payment Links) see
 *   src/lib/stripe/payment-link.ts. The two surfaces share the platform
 *   STRIPE_SECRET_KEY but differ on whether Stripe-Account header is set.
 *
 * RUNTIME:
 *   Server-only. Imported only from server actions, route handlers, and
 *   the saas/sync orchestrator.
 *
 * ENV VARS REQUIRED:
 *   STRIPE_SECRET_KEY        — platform secret key (sk_test_… or sk_live_…)
 *   NEXT_PUBLIC_APP_URL      — return URLs for hosted Checkout
 *   STRIPE_SAAS_WEBHOOK_SECRET — signing secret for the SaaS webhook
 *                                endpoint (separate from per-tenant Connect)
 */

import 'server-only'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

function stripeSecretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY
  if (!k) throw new Error('stripe_secret_key_missing')
  return k
}

function appBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL
  if (!u) throw new Error('next_public_app_url_missing')
  return u.replace(/\/$/, '')
}

function encodeForm(
  body: Record<string, string | number | boolean | undefined | null>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue
    params.append(k, String(v))
  }
  return params.toString()
}

async function stripeFetch<T>(
  path: string,
  init: {
    method: 'POST' | 'GET' | 'DELETE'
    body?: Record<string, string | number | boolean | undefined | null>
    /** Optional Idempotency-Key header for retry safety on POSTs. */
    idempotencyKey?: string
  },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeSecretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (init.idempotencyKey) {
    headers['Idempotency-Key'] = init.idempotencyKey
  }
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

// ── Types ────────────────────────────────────────────────────────────────

export type StripeProduct = {
  id: string
  active: boolean
  name: string
  description: string | null
  metadata: Record<string, string>
}

export type StripePrice = {
  id: string
  product: string
  active: boolean
  currency: string
  unit_amount: number | null
  recurring: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
  } | null
  metadata: Record<string, string>
}

export type StripeList<T> = {
  object: 'list'
  data: T[]
  has_more: boolean
  url: string
}

export type StripeCustomer = {
  id: string
  email: string | null
  name: string | null
  metadata: Record<string, string>
}

export type StripeCheckoutSession = {
  id: string
  url: string | null
  status: string | null
  customer: string | null
  subscription: string | null
  metadata: Record<string, string> | null
}

// ── Products ─────────────────────────────────────────────────────────────

export async function listAllProducts(): Promise<StripeProduct[]> {
  const out: StripeProduct[] = []
  let starting_after: string | undefined
  for (;;) {
    const params: Record<string, string> = { limit: '100' }
    if (starting_after) params.starting_after = starting_after
    const qs = new URLSearchParams(params).toString()
    const page = await stripeFetch<StripeList<StripeProduct>>(
      `/products?${qs}`,
      { method: 'GET' },
    )
    out.push(...page.data)
    if (!page.has_more || page.data.length === 0) break
    starting_after = page.data[page.data.length - 1].id
  }
  return out
}

export async function createProduct(args: {
  name: string
  description?: string | null
  metadata: Record<string, string>
}): Promise<StripeProduct> {
  const body: Record<string, string | number | boolean | null> = {
    name: args.name,
  }
  if (args.description) body.description = args.description
  for (const [k, v] of Object.entries(args.metadata)) {
    body[`metadata[${k}]`] = v
  }
  return stripeFetch<StripeProduct>('/products', {
    method: 'POST',
    body,
    idempotencyKey: `pawn_product_${args.metadata.plan_code ?? args.name}`,
  })
}

export async function updateProduct(
  productId: string,
  args: {
    name?: string
    description?: string | null
    metadata?: Record<string, string>
    active?: boolean
  },
): Promise<StripeProduct> {
  const body: Record<string, string | number | boolean | null> = {}
  if (args.name !== undefined) body.name = args.name
  if (args.description !== undefined) {
    body.description = args.description ?? ''
  }
  if (args.active !== undefined) body.active = args.active
  if (args.metadata) {
    for (const [k, v] of Object.entries(args.metadata)) {
      body[`metadata[${k}]`] = v
    }
  }
  return stripeFetch<StripeProduct>(`/products/${productId}`, {
    method: 'POST',
    body,
  })
}

// ── Prices ───────────────────────────────────────────────────────────────

export async function listPricesForProduct(
  productId: string,
): Promise<StripePrice[]> {
  const out: StripePrice[] = []
  let starting_after: string | undefined
  for (;;) {
    const params: Record<string, string> = {
      product: productId,
      limit: '100',
    }
    if (starting_after) params.starting_after = starting_after
    const qs = new URLSearchParams(params).toString()
    const page = await stripeFetch<StripeList<StripePrice>>(`/prices?${qs}`, {
      method: 'GET',
    })
    out.push(...page.data)
    if (!page.has_more || page.data.length === 0) break
    starting_after = page.data[page.data.length - 1].id
  }
  return out
}

export async function createRecurringPrice(args: {
  productId: string
  unitAmountCents: number
  currency?: string
  interval: 'month' | 'year'
  metadata: Record<string, string>
}): Promise<StripePrice> {
  const body: Record<string, string | number | boolean> = {
    product: args.productId,
    unit_amount: args.unitAmountCents,
    currency: (args.currency ?? 'usd').toLowerCase(),
    'recurring[interval]': args.interval,
    'recurring[interval_count]': 1,
  }
  for (const [k, v] of Object.entries(args.metadata)) {
    body[`metadata[${k}]`] = v
  }
  return stripeFetch<StripePrice>('/prices', {
    method: 'POST',
    body,
    idempotencyKey: `pawn_price_${args.metadata.plan_code ?? args.productId}_${args.interval}`,
  })
}

/** Deactivate (not delete) a price. Stripe doesn't allow deleting prices
 *  that have ever been used. We mark active=false so it stops surfacing on
 *  Checkout. */
export async function deactivatePrice(priceId: string): Promise<StripePrice> {
  return stripeFetch<StripePrice>(`/prices/${priceId}`, {
    method: 'POST',
    body: { active: false },
  })
}

// ── Customers ────────────────────────────────────────────────────────────

export async function createCustomer(args: {
  email?: string | null
  name?: string | null
  metadata: Record<string, string>
}): Promise<StripeCustomer> {
  const body: Record<string, string | number | boolean | null> = {}
  if (args.email) body.email = args.email
  if (args.name) body.name = args.name
  for (const [k, v] of Object.entries(args.metadata)) {
    body[`metadata[${k}]`] = v
  }
  return stripeFetch<StripeCustomer>('/customers', {
    method: 'POST',
    body,
    idempotencyKey: `pawn_customer_${args.metadata.tenant_id ?? Date.now()}`,
  })
}

export async function retrieveCustomer(
  customerId: string,
): Promise<StripeCustomer> {
  return stripeFetch<StripeCustomer>(`/customers/${customerId}`, {
    method: 'GET',
  })
}

// ── Subscription Checkout ────────────────────────────────────────────────

export async function createSubscriptionCheckoutSession(args: {
  customerId: string
  priceId: string
  /** Tenant id stamped into metadata so the webhook can route the event. */
  tenantId: string
  /** Plan code stamped into metadata for analytics. */
  planCode: string
  /** Billing cycle stamped into metadata. */
  cycle: 'monthly' | 'yearly'
  /** Path the user returns to on success/cancel. */
  returnPath: string
  /** Optional days of trial (overrides Stripe price default if any). */
  trialDays?: number | null
}): Promise<StripeCheckoutSession> {
  const base = appBaseUrl()
  const successUrl = `${base}${args.returnPath}?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${base}${args.returnPath}?cancelled=1`

  const body: Record<string, string | number | boolean> = {
    mode: 'subscription',
    customer: args.customerId,
    'line_items[0][price]': args.priceId,
    'line_items[0][quantity]': 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[tenant_id]': args.tenantId,
    'metadata[plan_code]': args.planCode,
    'metadata[cycle]': args.cycle,
    'subscription_data[metadata][tenant_id]': args.tenantId,
    'subscription_data[metadata][plan_code]': args.planCode,
    'subscription_data[metadata][cycle]': args.cycle,
  }
  if (args.trialDays && args.trialDays > 0) {
    body['subscription_data[trial_period_days]'] = args.trialDays
  }

  return stripeFetch<StripeCheckoutSession>('/checkout/sessions', {
    method: 'POST',
    body,
  })
}

// ── Subscription update (plan-CHANGE flow) ──────────────────────────────

export type StripeSubscription = {
  id: string
  status: string
  customer: string
  items: {
    data: Array<{ id: string; price: { id: string } }>
  }
}

/** Retrieve a subscription so we can locate its current item.id (needed
 *  for the price-swap update call). Stripe's "update subscription with
 *  new price" requires us to PATCH the existing item, not the
 *  subscription's price field directly. */
export async function retrieveSubscription(
  subscriptionId: string,
): Promise<StripeSubscription> {
  return stripeFetch<StripeSubscription>(`/subscriptions/${subscriptionId}`, {
    method: 'GET',
  })
}

/**
 * Swap a subscription's price (used for self-service plan-CHANGE). The
 * tenant's first item gets its price updated to `newPriceId`. Stripe
 * issues a prorated invoice automatically when proration_behavior is
 * 'create_prorations' (the default we use here).
 *
 * `metadata` updates are merged in atomically so the webhook handler's
 * tenant_id resolution stays accurate post-change.
 */
export async function updateSubscriptionPrice(args: {
  subscriptionId: string
  /** The Stripe price ID to switch to. */
  newPriceId: string
  /** Stripe's billing-cycle anchor — pass 'create_prorations' (default)
   *  to bill the difference now, or 'none' to defer until next renewal. */
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice'
  /** Re-stamp metadata so the webhook routes correctly. */
  metadata: Record<string, string>
  idempotencyKey?: string
}): Promise<StripeSubscription> {
  const sub = await retrieveSubscription(args.subscriptionId)
  const itemId = sub.items?.data?.[0]?.id
  if (!itemId) {
    throw new Error('subscription_has_no_items')
  }

  const body: Record<string, string | number | boolean> = {
    'items[0][id]': itemId,
    'items[0][price]': args.newPriceId,
    proration_behavior: args.prorationBehavior ?? 'create_prorations',
  }
  for (const [k, v] of Object.entries(args.metadata)) {
    body[`metadata[${k}]`] = v
  }

  return stripeFetch<StripeSubscription>(
    `/subscriptions/${args.subscriptionId}`,
    {
      method: 'POST',
      body,
      idempotencyKey: args.idempotencyKey,
    },
  )
}

// ── Webhook signing ──────────────────────────────────────────────────────

/**
 * Verify a Stripe webhook signature using Web Crypto (Edge-runtime safe).
 * Stripe signs the payload with HMAC-SHA256 over `${timestamp}.${rawBody}`.
 *
 * Tolerance defaults to 5 minutes (Stripe's recommendation).
 */
export async function verifyWebhookSignature(args: {
  payload: string
  signatureHeader: string | null
  secret: string
  toleranceSeconds?: number
}): Promise<{ ok: true; timestamp: number } | { ok: false; reason: string }> {
  if (!args.signatureHeader) return { ok: false, reason: 'missing_signature' }
  if (!args.secret) return { ok: false, reason: 'missing_secret' }

  // Header format: "t=1234567890,v1=hex,v1=hex,v0=..."
  const parts = args.signatureHeader.split(',').map((p) => p.trim())
  let ts: number | null = null
  const v1s: string[] = []
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq)
    const v = p.slice(eq + 1)
    if (k === 't') ts = Number(v)
    else if (k === 'v1') v1s.push(v)
  }
  if (ts == null || !Number.isFinite(ts)) {
    return { ok: false, reason: 'malformed_timestamp' }
  }
  if (v1s.length === 0) return { ok: false, reason: 'no_v1_signature' }

  const tolerance = args.toleranceSeconds ?? 300
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > tolerance) {
    return { ok: false, reason: 'timestamp_outside_tolerance' }
  }

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(args.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${ts}.${args.payload}`),
  )
  const expected = bytesToHex(new Uint8Array(sig))

  // Constant-time compare against each provided v1.
  const ok = v1s.some((v) => safeEqualHex(v, expected))
  if (!ok) return { ok: false, reason: 'signature_mismatch' }
  return { ok: true, timestamp: ts }
}

function bytesToHex(b: Uint8Array): string {
  const hex: string[] = []
  for (let i = 0; i < b.length; i++) {
    hex.push(b[i].toString(16).padStart(2, '0'))
  }
  return hex.join('')
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
