import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  payoffFromLoan,
  r4,
  todayDateString,
} from '@/lib/pawn/math'
import { logAudit } from '@/lib/audit'
import {
  findStripeLinkBySessionId,
  findStripeLinkByPaymentIntentId,
  updateStripeLinkBySessionId,
} from '@/lib/portal/stripe-payment-links'
import type {
  LoanEventInsert,
  LoanEventRow,
  LoanRow,
} from '@/types/database-aliases'

/**
 * Stripe webhook receiver. Per-tenant Connect events route to this single
 * endpoint; we route by metadata.kind into loan-payoff or layaway-payment
 * handlers. Idempotent on stripe_payment_links.stripe_session_id (UNIQUE
 * column) — we look up the row first and bail early if it's already paid.
 *
 * Expected events:
 *   checkout.session.completed   — primary success signal for hosted Checkout.
 *   payment_intent.succeeded     — fallback (some integrations emit this for
 *                                   Checkout sessions; we read metadata to
 *                                   resolve the right kind/source).
 *
 * Signature verification:
 *   Stripe signs the request with the per-endpoint signing secret. Until
 *   the operator provisions per-tenant signing secrets we read from
 *   STRIPE_WEBHOOK_SECRET (platform-level). If unset, we run in "no-verify"
 *   mode for local dev; in production this MUST be set.
 *
 * Runtime: server-only Node — Stripe webhook signing relies on Node crypto.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StripeEventEnvelope = {
  id: string
  type: string
  data: {
    object: Record<string, unknown>
  }
  account?: string
}

type CheckoutSessionLite = {
  id: string
  client_reference_id?: string | null
  payment_intent?: string | null
  payment_status?: string | null
  amount_total?: number | null
  currency?: string | null
  metadata?: Record<string, string> | null
}

type PaymentIntentLite = {
  id: string
  amount?: number | null
  currency?: string | null
  metadata?: Record<string, string> | null
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? null

  // Verify signature when secret is configured. We avoid the Stripe SDK
  // dependency by re-implementing the v1 scheme inline.
  if (secret) {
    const ok = await verifyStripeSignature(raw, sig, secret)
    if (!ok) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
    }
  }

  let event: StripeEventEnvelope
  try {
    event = JSON.parse(raw) as StripeEventEnvelope
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as CheckoutSessionLite
      await handleCheckoutSessionCompleted(session)
    } else if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as PaymentIntentLite
      await handlePaymentIntentSucceeded(pi)
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe-webhook] handler error', err)
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }
}

async function handleCheckoutSessionCompleted(
  session: CheckoutSessionLite,
): Promise<void> {
  if (!session.id) return
  // Quick filter by payment_status — Stripe also fires this event for
  // unpaid completion (e.g. "save card" flows). We only act on paid.
  if (session.payment_status && session.payment_status !== 'paid') {
    // Mark our row but don't create payment events.
    await markLinkStatus(session.id, 'pending')
    return
  }

  const link = await findStripeLinkBySessionId(session.id)
  const meta = session.metadata ?? {}
  const kind = (link?.source_kind ?? meta.kind) as
    | 'loan_payoff'
    | 'layaway_payment'
    | undefined
  const sourceId =
    link?.source_id ?? session.client_reference_id ?? meta.source_id
  const tenantId = link?.tenant_id ?? meta.tenant_id
  const customerId = link?.customer_id ?? meta.customer_id
  const amount = (() => {
    if (link?.amount != null) return Number(link.amount)
    if (typeof session.amount_total === 'number') {
      return r4(session.amount_total / 100)
    }
    return 0
  })()
  const piId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null

  if (!kind || !sourceId || !tenantId || !customerId || amount <= 0) {
    console.warn('[stripe-webhook] missing fields for session', session.id)
    return
  }

  // Idempotency — already marked paid? Bail.
  if (link?.status === 'paid') {
    return
  }

  if (kind === 'loan_payoff') {
    await applyLoanPayment({
      tenantId,
      loanId: sourceId,
      amount,
      stripeSessionId: session.id,
      stripePaymentIntentId: piId,
    })
  } else if (kind === 'layaway_payment') {
    await applyLayawayPayment({
      tenantId,
      layawayId: sourceId,
      amount,
      stripeSessionId: session.id,
      stripePaymentIntentId: piId,
    })
  }

  // Mark link row paid (idempotent).
  await markLinkPaid(session.id, piId)
}

async function handlePaymentIntentSucceeded(
  pi: PaymentIntentLite,
): Promise<void> {
  // Some integrations only emit payment_intent.succeeded. We try to find a
  // matching link row by payment_intent_id; if missing, fall back to
  // metadata-driven routing.
  const link = await findStripeLinkByPaymentIntentId(pi.id)
  if (!link) {
    // Nothing to do — checkout.session.completed will likely arrive too
    // and carry the session_id we use to key bookkeeping.
    return
  }
  if (link.status === 'paid') return

  const amount =
    link.amount != null
      ? Number(link.amount)
      : pi.amount != null
      ? r4(pi.amount / 100)
      : 0
  if (amount <= 0) return

  if (link.source_kind === 'loan_payoff') {
    await applyLoanPayment({
      tenantId: link.tenant_id,
      loanId: link.source_id,
      amount,
      stripeSessionId: link.stripe_session_id,
      stripePaymentIntentId: pi.id,
    })
  } else if (link.source_kind === 'layaway_payment') {
    await applyLayawayPayment({
      tenantId: link.tenant_id,
      layawayId: link.source_id,
      amount,
      stripeSessionId: link.stripe_session_id,
      stripePaymentIntentId: pi.id,
    })
  }

  await markLinkPaid(link.stripe_session_id, pi.id)
}

async function applyLoanPayment(args: {
  tenantId: string
  loanId: string
  amount: number
  stripeSessionId: string
  stripePaymentIntentId: string | null
}): Promise<void> {
  const admin = createAdminClient()

  // Re-load loan + events so we can compute the split + redemption flip.
  const { data: loanData, error: loanErr } = await admin
    .from('loans')
    .select(
      `id, tenant_id, principal, interest_rate_monthly, min_monthly_charge,
       issue_date, status,
       events:loan_events(principal_paid, interest_paid, fees_paid)`,
    )
    .eq('id', args.loanId)
    .maybeSingle()

  if (loanErr || !loanData) {
    console.error('[stripe-webhook] loan not found', args.loanId, loanErr)
    return
  }

  type LoanWithEvents = LoanRow & {
    events?: Pick<
      LoanEventRow,
      'principal_paid' | 'interest_paid' | 'fees_paid'
    >[] | null
  }
  const loan = loanData as unknown as LoanWithEvents
  if (loan.tenant_id !== args.tenantId) {
    console.warn('[stripe-webhook] tenant mismatch for loan', args.loanId)
    return
  }

  const events = loan.events ?? []
  const today = todayDateString()
  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
      min_monthly_charge: loan.min_monthly_charge,
    },
    events,
    today,
  )

  // Apply interest first, remainder to principal. If amount exceeds payoff,
  // any extra is recorded as fees so we don't break the redemption math.
  const interestPaid = Math.min(args.amount, payoff.interestOutstanding)
  const remainingAfterInterest = r4(args.amount - interestPaid)
  const principalPaid = Math.min(
    remainingAfterInterest,
    payoff.principalOutstanding,
  )
  const feesPaid = r4(remainingAfterInterest - principalPaid)
  const totalApplied = r4(interestPaid + principalPaid + feesPaid)

  // Determine if this clears the loan.
  const newPrincipalApplied = r4(payoff.principalApplied + principalPaid)
  const principalRemaining = r4(
    payoff.principal - newPrincipalApplied,
  )
  const willRedeem = principalRemaining <= 0

  const eventInsert: LoanEventInsert = {
    loan_id: loan.id,
    tenant_id: args.tenantId,
    event_type: willRedeem ? 'redemption' : 'payment',
    amount: totalApplied,
    principal_paid: principalPaid,
    interest_paid: interestPaid,
    fees_paid: feesPaid,
    payment_method: 'card',
    notes: `Online payment via Stripe (session ${args.stripeSessionId})`,
  }

  const { data: insertedEvent, error: evErr } = await admin
    .from('loan_events')
    .insert(eventInsert)
    .select('id')
    .single()

  if (evErr) {
    console.error('[stripe-webhook] loan_event insert failed', evErr)
    return
  }

  if (willRedeem && loan.status !== 'redeemed') {
    await admin
      .from('loans')
      .update({ status: 'redeemed' })
      .eq('id', loan.id)
  } else if (
    !willRedeem &&
    loan.status === 'active'
  ) {
    await admin
      .from('loans')
      .update({ status: 'partial_paid' })
      .eq('id', loan.id)
  }

  await logAudit({
    tenantId: args.tenantId,
    // System-actor; webhook events have no auth user. We pass a zero UUID
    // shape via empty string; logAudit accepts any string.
    userId: '00000000-0000-0000-0000-000000000000',
    action: willRedeem ? 'update' : 'create',
    tableName: 'loan_events',
    recordId: (insertedEvent as { id: string }).id,
    changes: {
      via: 'stripe_webhook',
      session_id: args.stripeSessionId,
      payment_intent_id: args.stripePaymentIntentId,
      principal_paid: principalPaid,
      interest_paid: interestPaid,
      fees_paid: feesPaid,
      redeemed: willRedeem,
    },
  })
}

async function applyLayawayPayment(args: {
  tenantId: string
  layawayId: string
  amount: number
  stripeSessionId: string
  stripePaymentIntentId: string | null
}): Promise<void> {
  const admin = createAdminClient()

  const { data: layawayData } = await admin
    .from('layaways')
    .select('id, tenant_id, status, total_due, paid_total, balance_remaining')
    .eq('id', args.layawayId)
    .maybeSingle()

  if (!layawayData) {
    console.error('[stripe-webhook] layaway not found', args.layawayId)
    return
  }

  type LayawayLite = {
    id: string
    tenant_id: string
    status: string
    total_due: number | string | null
    paid_total: number | string | null
    balance_remaining: number | string | null
  }
  const lay = layawayData as unknown as LayawayLite

  if (lay.tenant_id !== args.tenantId) {
    console.warn('[stripe-webhook] tenant mismatch for layaway', args.layawayId)
    return
  }

  const totalDue = Number(lay.total_due ?? 0)
  const paidTotal = Number(lay.paid_total ?? 0)
  const newPaidTotal = r4(paidTotal + args.amount)
  const newBalance = r4(Math.max(0, totalDue - newPaidTotal))
  const willComplete = newBalance <= 0

  // Insert layaway_payments row.
  const { data: paymentRow, error: payErr } = await admin
    .from('layaway_payments')
    .insert({
      layaway_id: lay.id,
      tenant_id: args.tenantId,
      amount: args.amount,
      payment_method: 'card',
      card_present_status: 'succeeded',
      stripe_payment_intent_id: args.stripePaymentIntentId,
      notes: `Online payment via Stripe (session ${args.stripeSessionId})`,
    })
    .select('id')
    .single()

  if (payErr) {
    console.error('[stripe-webhook] layaway_payment insert failed', payErr)
    return
  }

  const validStatus = (
    ['active', 'completed', 'cancelled', 'defaulted'] as const
  ).includes(lay.status as 'active' | 'completed' | 'cancelled' | 'defaulted')
    ? (lay.status as 'active' | 'completed' | 'cancelled' | 'defaulted')
    : 'active'

  await admin
    .from('layaways')
    .update({
      paid_total: newPaidTotal,
      balance_remaining: newBalance,
      status: willComplete ? 'completed' : validStatus,
      ...(willComplete ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', lay.id)

  await logAudit({
    tenantId: args.tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    action: 'layaway_payment_add',
    tableName: 'layaway_payments',
    recordId: (paymentRow as { id: string }).id,
    changes: {
      via: 'stripe_webhook',
      session_id: args.stripeSessionId,
      payment_intent_id: args.stripePaymentIntentId,
      amount: args.amount,
      completed: willComplete,
    },
  })
}

async function markLinkPaid(
  sessionId: string,
  paymentIntentId: string | null,
): Promise<void> {
  await updateStripeLinkBySessionId(sessionId, {
    status: 'paid',
    paid_at: new Date().toISOString(),
    stripe_payment_intent_id: paymentIntentId,
  })
}

async function markLinkStatus(
  sessionId: string,
  status: 'pending' | 'paid' | 'expired' | 'cancelled',
): Promise<void> {
  await updateStripeLinkBySessionId(sessionId, { status })
}

// ────────────────────────────────────────────────────────────────────────
// Stripe v1 signature verification — implemented inline so we don't pull
// in the Stripe SDK just for this. https://stripe.com/docs/webhooks/signatures
// ────────────────────────────────────────────────────────────────────────

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!header) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const idx = p.indexOf('=')
      return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()]
    }),
  ) as { t?: string; v1?: string }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false

  // Tolerance window: 5 minutes.
  const ts = parseInt(t, 10)
  if (!isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 5 * 60) return false

  const signedPayload = `${t}.${payload}`
  const expected = await hmacSha256(secret, signedPayload)
  // Constant-time compare.
  return timingSafeEqual(expected, v1)
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
