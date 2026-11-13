import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { payoffFromLoan } from '@/lib/pawn/math'
import { r2 } from '@/lib/pos/cart'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import { afterSaleCompleted, layawayAddPayment } from '@/lib/pos/money'
import { releaseOrder, sendOrderMessage } from '@/lib/store/orders'
import type { Database } from '@/types/database'
import { logAudit } from '@/lib/audit'
import {
  findStripeLinkBySessionId,
  findStripeLinkByPaymentIntentId,
  updateStripeLinkBySessionId,
} from '@/lib/portal/stripe-payment-links'
import {
  findTenantByStripeAccountId,
  syncAccountStatus,
} from '@/lib/stripe/connect'
import { deriveConnectStatus } from '@/lib/stripe/connect-status'
import {
  authorizeLinkEvent,
  webhookSecretOrNull,
} from '@/lib/stripe/webhook-guard'
import { settleSaleCardPayment } from '@/lib/pos/card-settle'
import type {
  StripePaymentLinkRow,
  LoanEventRow,
  LoanRow,
} from '@/types/database-aliases'

/**
 * Stripe webhook receiver. Per-tenant Connect events route to this single
 * endpoint; we route by OUR stripe_payment_links row (written server-side
 * when the session was created) into loan-payoff or layaway-payment
 * handlers. Idempotent on stripe_payment_links.stripe_session_id (UNIQUE
 * column) — we look up the row first and bail early if it's already paid.
 *
 * Expected events:
 *   checkout.session.completed   — primary success signal for hosted Checkout.
 *   payment_intent.succeeded     — fallback (some integrations emit this for
 *                                   Checkout sessions; matched to a link row
 *                                   by payment_intent id).
 *   account.updated              — Connect onboarding status changed on a
 *                                   tenant's Express account; mirror the
 *                                   charges / payouts / details flags onto
 *                                   tenant_billing_settings (patches/0069).
 *
 * This endpoint must be registered in the Stripe Dashboard as a CONNECT
 * webhook ("Listen to events on Connected accounts") so events from every
 * tenant's account arrive here with `event.account` set.
 *
 * Trust model (see lib/stripe/webhook-guard.ts):
 *   1. Signature. Stripe signs the request with the endpoint's signing
 *      secret (STRIPE_WEBHOOK_SECRET). With no secret configured the
 *      endpoint refuses EVERY request (503) — there is no unsigned mode,
 *      in any environment.
 *   2. Our link row. A payment is applied only when a stripe_payment_links
 *      row exists for the session. Event metadata never selects the loan,
 *      layaway, tenant or amount.
 *   3. Account. `event.account` must be the connected account that belongs
 *      to the link's tenant, so one shop's Stripe account can never settle
 *      another shop's loan.
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

type AccountLite = {
  id: string
  charges_enabled?: boolean | null
  payouts_enabled?: boolean | null
  details_submitted?: boolean | null
  metadata?: Record<string, string> | null
  requirements?: {
    currently_due?: string[]
    disabled_reason?: string | null
  } | null
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const secret = webhookSecretOrNull(process.env)

  // Fail closed. An unsigned request can claim anything, and this endpoint
  // moves money — refuse outright until the signing secret is configured.
  if (!secret) {
    console.error(
      '[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — refusing request',
    )
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 },
    )
  }

  // We avoid the Stripe SDK dependency by re-implementing the v1 scheme inline.
  const signatureOk = await verifyStripeSignature(raw, sig, secret)
  if (!signatureOk) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
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
      // Online store orders are matched by their own row, not a link row.
      if (!(await handleOnlineOrderSession(session, event.account, 'completed'))) {
        await handleCheckoutSessionCompleted(session, event.account)
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as CheckoutSessionLite
      await handleOnlineOrderSession(session, event.account, 'expired')
    } else if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as PaymentIntentLite
      await handlePaymentIntentSucceeded(pi, event.account)
    } else if (event.type === 'account.updated') {
      const account = event.data.object as AccountLite
      await handleAccountUpdated(account)
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe-webhook] handler error', err)
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }
}

/**
 * Resolve the link row for an event and decide whether the event may move
 * money for it. Returns the link when authorized, null (after logging the
 * reason) when not.
 */
async function authorizedLink(args: {
  link: StripePaymentLinkRow | null
  eventAccount: string | undefined
  ref: string
}): Promise<StripePaymentLinkRow | null> {
  const billing = args.eventAccount
    ? await findTenantByStripeAccountId(args.eventAccount)
    : null
  const decision = authorizeLinkEvent({
    link: args.link,
    eventAccount: args.eventAccount,
    accountTenantId: billing?.tenant_id ?? null,
  })
  if (!decision.ok) {
    console.warn(
      `[stripe-webhook] refused ${args.ref}: ${decision.reason}`,
      { account: args.eventAccount ?? null },
    )
    return null
  }
  return args.link
}

/**
 * An online store order's Checkout session completed or expired.
 *
 * Returns true when the session belongs to an online order (so the caller
 * stops), false when it is not one. Same trust rules as the link rows: the
 * order row is ours (session id written when we created it), the event's
 * account must be the shop's connected account, and online_order_paid()
 * refuses any amount other than the order total in cents.
 */
async function handleOnlineOrderSession(
  session: CheckoutSessionLite,
  eventAccount: string | undefined,
  kind: 'completed' | 'expired',
): Promise<boolean> {
  if (!session.id) return false
  const admin = createAdminClient()
  const { data: order } = await admin
    .from('online_orders')
    .select('id, tenant_id, stripe_account_id, status')
    .eq('stripe_session_id', session.id)
    .maybeSingle()
  if (!order) return false

  const billing = eventAccount ? await findTenantByStripeAccountId(eventAccount) : null
  if (!billing || billing.tenant_id !== order.tenant_id ||
      (order.stripe_account_id && order.stripe_account_id !== eventAccount)) {
    console.warn(`[stripe-webhook] refused online order session ${session.id}: account mismatch`, {
      account: eventAccount ?? null,
    })
    return true
  }

  if (kind === 'expired') {
    if (await releaseOrder(order.tenant_id, order.id, 'expired')) {
      await logAudit({
        tenantId: order.tenant_id,
        userId: SYSTEM_USER,
        action: 'online_order_release',
        tableName: 'online_orders',
        recordId: order.id,
        changes: { via: 'stripe_webhook', reason: 'session_expired' },
      })
    }
    return true
  }

  if (session.payment_status && session.payment_status !== 'paid') return true
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null
  const paidArgs = {
    p_tenant_id: order.tenant_id,
    p_order_id: order.id,
    p_session_id: session.id,
    p_pi: pi,
    p_amount_cents: session.amount_total ?? -1,
  } as unknown as Database['public']['Functions']['online_order_paid']['Args']
  const { data, error } = await admin.rpc('online_order_paid', paidArgs)
  // Throw → 500 → Stripe retries; the post is idempotent on the order row.
  if (error) throw new Error(`online_order_paid_failed: ${error.message}`)
  const row = data?.[0]
  if (!row || row.o_reason === 'duplicate') return true

  if (row.o_reason === 'applied' && row.o_sale_id) {
    await logAudit({
      tenantId: order.tenant_id,
      userId: SYSTEM_USER,
      action: 'online_order_paid',
      tableName: 'online_orders',
      recordId: order.id,
      changes: { via: 'stripe_webhook', session_id: session.id, payment_intent_id: pi, sale_id: row.o_sale_id },
    })
    await afterSaleCompleted({ tenantId: order.tenant_id, saleId: row.o_sale_id })
    await sendOrderMessage({ tenantId: order.tenant_id, orderId: order.id, kind: 'online_order_confirmed' })
  } else {
    // Charged, but the pieces were gone or the amount was wrong.
    console.error(`[stripe-webhook] online order ${order.id}: ${row.o_reason} — needs a refund`)
    await logAudit({
      tenantId: order.tenant_id,
      userId: SYSTEM_USER,
      action: 'stripe_payment_needs_refund',
      tableName: 'online_orders',
      recordId: order.id,
      changes: { reason: row.o_reason, amount_cents: session.amount_total ?? null, session_id: session.id, payment_intent_id: pi },
    })
  }
  return true
}

async function handleCheckoutSessionCompleted(
  session: CheckoutSessionLite,
  eventAccount: string | undefined,
): Promise<void> {
  if (!session.id) return

  // Our own link row is the ONLY thing that says which loan / layaway a
  // session pays. No row, or a row that belongs to a different tenant than
  // the account the event came from → nothing happens.
  const link = await authorizedLink({
    link: await findStripeLinkBySessionId(session.id),
    eventAccount,
    ref: `session ${session.id}`,
  })
  if (!link) return

  // Quick filter by payment_status — Stripe also fires this event for
  // unpaid completion (e.g. "save card" flows). We only act on paid.
  if (session.payment_status && session.payment_status !== 'paid') {
    // Mark our row but don't create payment events.
    await markLinkStatus(session.id, 'pending')
    return
  }

  const kind = link.source_kind
  const sourceId = link.source_id
  const tenantId = link.tenant_id
  const amount = link.amount != null ? Number(link.amount) : 0
  const piId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null

  if (!sourceId || !tenantId || amount <= 0) {
    console.warn('[stripe-webhook] incomplete link row for session', session.id)
    return
  }

  // Idempotency — already marked paid? Bail.
  if (link.status === 'paid') {
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
  eventAccount: string | undefined,
): Promise<void> {
  // A POS card tender (PaymentIntent created by the sale's addPaymentAction)
  // settles here: this is what makes it count toward the sale's paid_total.
  if (await settleSaleCardTender(pi, eventAccount)) return

  // Some integrations only emit payment_intent.succeeded. We match a link
  // row by payment_intent_id; with no row there is nothing to do —
  // checkout.session.completed will arrive too and carry the session_id we
  // key bookkeeping on. Metadata is never used for routing.
  const found = await findStripeLinkByPaymentIntentId(pi.id)
  if (!found) return
  const link = await authorizedLink({
    link: found,
    eventAccount,
    ref: `payment_intent ${pi.id}`,
  })
  if (!link) return
  if (link.status === 'paid') return

  const amount =
    link.amount != null
      ? Number(link.amount)
      : pi.amount != null
      ? r2(pi.amount / 100)
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

/**
 * Settle a POS card tender whose PaymentIntent just succeeded.
 *
 * Returns true when the PaymentIntent belongs to a sale_payments row (so the
 * caller stops — whether it was applied or refused), false when it is not a
 * POS tender at all.
 *
 * Same trust rules as the payment links: the row is OURS (written when the
 * PaymentIntent was created), the event's account must be the tender's
 * tenant's account, and the amount must be the amount we asked for.
 */
async function settleSaleCardTender(
  pi: PaymentIntentLite,
  eventAccount: string | undefined,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data: pay } = await admin
    .from('sale_payments')
    .select('id, sale_id, tenant_id, amount, payment_method')
    .eq('stripe_payment_intent_id', pi.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!pay || pay.payment_method !== 'card') return false

  const billing = eventAccount
    ? await findTenantByStripeAccountId(eventAccount)
    : null
  if (!billing || billing.tenant_id !== pay.tenant_id) {
    console.warn(
      `[stripe-webhook] refused card tender ${pay.id}: account does not belong to its tenant`,
      { account: eventAccount ?? null },
    )
    return true
  }

  const expectedCents = Math.max(1, Math.round(Number(pay.amount) * 100))
  if (pi.amount !== expectedCents) {
    console.error(
      `[stripe-webhook] refused card tender ${pay.id}: amount ${pi.amount} != expected ${expectedCents}`,
    )
    return true
  }

  const settled = await settleSaleCardPayment(admin, pay.id)
  // Throw → 500 → Stripe retries. The settle is idempotent, so a retry is safe.
  if (!settled.ok) throw new Error(`card_settle_failed: ${settled.error}`)

  if (settled.reason === 'sale_not_open') {
    // The card was charged after the sale closed. Money is on the account
    // with no open sale to attach it to — someone has to refund it.
    console.error(
      `[stripe-webhook] card tender ${pay.id} succeeded but sale ${pay.sale_id} is not open — needs a refund`,
    )
  }

  if (settled.reason !== 'not_pending') {
    await logAudit({
      tenantId: pay.tenant_id,
      userId: '00000000-0000-0000-0000-000000000000',
      action: 'card_present_succeeded',
      tableName: 'sale_payments',
      recordId: pay.id,
      changes: {
        sale_id: pay.sale_id,
        via: 'stripe_webhook',
        payment_intent_id: pi.id,
        applied: settled.applied,
        reason: settled.reason,
        amount: settled.amount,
        paid_total: settled.paidTotal,
      },
    })
  }
  return true
}

/**
 * Mirror a connected account's onboarding flags onto the owning tenant.
 * Routing is by stripe_account_id (unique partial index, 0069). Accounts
 * we do not know (platform account itself, stale test accounts) are
 * ignored — no row, no write.
 */
async function handleAccountUpdated(account: AccountLite): Promise<void> {
  if (!account?.id) return
  const billing = await findTenantByStripeAccountId(account.id)
  if (!billing) {
    console.warn('[stripe-webhook] account.updated for unknown account', account.id)
    return
  }

  const before = deriveConnectStatus({
    stripeAccountId: billing.stripe_account_id,
    chargesEnabled: billing.stripe_charges_enabled,
    payoutsEnabled: billing.stripe_payouts_enabled,
    detailsSubmitted: billing.stripe_details_submitted,
  })

  const patch = await syncAccountStatus({
    tenantId: billing.tenant_id,
    account,
    existingConnectedAt: billing.stripe_connected_at,
  })

  const after = deriveConnectStatus({
    stripeAccountId: account.id,
    chargesEnabled: patch.stripe_charges_enabled,
    payoutsEnabled: patch.stripe_payouts_enabled,
    detailsSubmitted: patch.stripe_details_submitted,
  })

  const flagsChanged =
    billing.stripe_charges_enabled !== patch.stripe_charges_enabled ||
    billing.stripe_payouts_enabled !== patch.stripe_payouts_enabled ||
    billing.stripe_details_submitted !== patch.stripe_details_submitted
  if (!flagsChanged) return

  await logAudit({
    tenantId: billing.tenant_id,
    userId: null,
    action: 'stripe_connect_status_sync',
    tableName: 'tenant_billing_settings',
    recordId: billing.tenant_id,
    changes: {
      via: 'stripe_webhook',
      event: 'account.updated',
      stripe_account_id: account.id,
      status_before: before,
      status_after: after,
      charges_enabled: patch.stripe_charges_enabled,
      payouts_enabled: patch.stripe_payouts_enabled,
      details_submitted: patch.stripe_details_submitted,
      requirements_currently_due: account.requirements?.currently_due ?? [],
      disabled_reason: account.requirements?.disabled_reason ?? null,
    },
  })
}

/**
 * Post an online loan payment (REVIEW-2026-11-11 finding 11).
 *
 * The interest/principal split is computed here from the loan's events and
 * the SHOP's today (not UTC). loan_apply_online_payment() then posts it under
 * a row lock, only if the loan is still open and its principal has not moved
 * since this split was computed. If it moved (a counter payment landed in
 * between), the function raises 'loan_changed' and we recompute — up to
 * three times, then throw so Stripe retries the event later.
 *
 * Money that could not be applied — the loan was already closed, or the
 * charge was more than the payoff — is never booked as fees: it is logged
 * as stripe_payment_needs_refund for staff to refund.
 */
async function applyLoanPayment(args: {
  tenantId: string
  loanId: string
  amount: number
  stripeSessionId: string
  stripePaymentIntentId: string | null
}): Promise<void> {
  const admin = createAdminClient()
  const { timezone } = await loadTenantRules(admin, args.tenantId)
  const today = todayInTimezone(timezone)

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: loanData, error: loanErr } = await admin
      .from('loans')
      .select(
        `id, tenant_id, principal, interest_rate_monthly, min_monthly_charge,
         issue_date, status,
         events:loan_events(principal_paid, interest_paid, fees_paid)`,
      )
      .eq('id', args.loanId)
      .eq('tenant_id', args.tenantId)
      .maybeSingle()
    if (loanErr || !loanData) {
      console.error('[stripe-webhook] loan not found', args.loanId, loanErr)
      return
    }

    type LoanWithEvents = LoanRow & {
      events?: Pick<LoanEventRow, 'principal_paid' | 'interest_paid' | 'fees_paid'>[] | null
    }
    const loan = loanData as unknown as LoanWithEvents
    const events = loan.events ?? []
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
    const principalPaidBefore = r2(events.reduce((acc, e) => acc + Number(e.principal_paid ?? 0), 0))

    // Interest first, then principal, in cents. Anything over the payoff is
    // NOT applied — it comes back as excess to refund.
    const amount = r2(args.amount)
    const interestPaid = r2(Math.min(amount, payoff.interestOutstanding))
    const principalPaid = r2(Math.min(r2(amount - interestPaid), payoff.principalOutstanding))

    const params = {
      p_tenant_id: args.tenantId,
      p_loan_id: args.loanId,
      p_amount: amount,
      p_interest: interestPaid,
      p_principal: principalPaid,
      p_principal_paid_before: principalPaidBefore,
      p_stripe_session: args.stripeSessionId,
      p_stripe_pi: args.stripePaymentIntentId,
    } as unknown as Database['public']['Functions']['loan_apply_online_payment']['Args']
    const { data, error } = await admin.rpc('loan_apply_online_payment', params)

    if (error?.message?.includes('loan_changed') && attempt < 3) continue
    // Throw → 500 → Stripe retries; the post is idempotent on the session.
    if (error) throw new Error(`loan_payment_failed: ${error.message}`)
    const row = data?.[0]
    if (!row) throw new Error('loan_payment_failed: no_result')
    if (row.o_reason === 'duplicate') return

    const excess = Number(row.o_excess ?? 0)
    if (row.o_reason === 'applied') {
      await logAudit({
        tenantId: args.tenantId,
        userId: SYSTEM_USER,
        action: row.o_redeemed ? 'update' : 'create',
        tableName: 'loan_events',
        recordId: row.o_event_id,
        changes: {
          via: 'stripe_webhook',
          session_id: args.stripeSessionId,
          payment_intent_id: args.stripePaymentIntentId,
          principal_paid: principalPaid,
          interest_paid: interestPaid,
          redeemed: row.o_redeemed,
        },
      })
    }
    if (excess > 0) {
      await flagRefund({
        tenantId: args.tenantId,
        tableName: 'loans',
        recordId: args.loanId,
        reason: row.o_reason === 'loan_closed' ? 'loan_closed' : 'overpaid',
        amount: excess,
        stripeSessionId: args.stripeSessionId,
        stripePaymentIntentId: args.stripePaymentIntentId,
      })
    }
    return
  }
}

/**
 * Post an online layaway payment (REVIEW-2026-11-11 finding 12).
 *
 * layaway_add_payment() writes the layaway payment, its mirror on the sale
 * and both paid totals; when the balance reaches zero it completes the sale
 * (stock to sold, consignor accrued) exactly as the counter does. Idempotent
 * on the Checkout session. Money it could not apply is flagged for refund.
 */
async function applyLayawayPayment(args: {
  tenantId: string
  layawayId: string
  amount: number
  stripeSessionId: string
  stripePaymentIntentId: string | null
}): Promise<void> {
  const r = await layawayAddPayment({
    tenantId: args.tenantId,
    userId: null,
    layawayId: args.layawayId,
    amount: args.amount,
    method: 'card',
    cardStatus: 'succeeded',
    paymentIntentId: args.stripePaymentIntentId,
    stripeSessionId: args.stripeSessionId,
    notes: `Online payment via Stripe (session ${args.stripeSessionId})`,
  })
  // Throw → 500 → Stripe retries; the post is idempotent on the session.
  if (!r.ok) throw new Error(`layaway_payment_failed: ${r.message}`)
  const out = r.data
  if (out.reason === 'duplicate') return

  if (out.paymentId) {
    await logAudit({
      tenantId: args.tenantId,
      userId: SYSTEM_USER,
      action: 'layaway_payment_add',
      tableName: 'layaway_payments',
      recordId: out.paymentId,
      changes: {
        via: 'stripe_webhook',
        session_id: args.stripeSessionId,
        payment_intent_id: args.stripePaymentIntentId,
        amount: r2(args.amount - out.excess),
        completed: out.completed,
      },
    })
  }
  if (out.completed) {
    const { data: lay } = await createAdminClient()
      .from('layaways')
      .select('sale_id')
      .eq('id', args.layawayId)
      .eq('tenant_id', args.tenantId)
      .maybeSingle()
    await logAudit({
      tenantId: args.tenantId,
      userId: SYSTEM_USER,
      action: 'layaway_complete',
      tableName: 'layaways',
      recordId: args.layawayId,
      changes: { via: 'stripe_webhook', paid_total: out.paidTotal },
    })
    if (lay?.sale_id) await afterSaleCompleted({ tenantId: args.tenantId, saleId: lay.sale_id })
  }
  if (out.excess > 0) {
    await flagRefund({
      tenantId: args.tenantId,
      tableName: 'layaways',
      recordId: args.layawayId,
      reason: out.reason === 'layaway_not_active' ? 'layaway_not_active' : 'overpaid',
      amount: out.excess,
      stripeSessionId: args.stripeSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
    })
  }
}

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000'

/** A customer was charged for something we could not apply. Staff refund it. */
async function flagRefund(args: {
  tenantId: string
  tableName: 'loans' | 'layaways'
  recordId: string
  reason: string
  amount: number
  stripeSessionId: string
  stripePaymentIntentId: string | null
}): Promise<void> {
  console.error(
    `[stripe-webhook] ${args.tableName} ${args.recordId}: $${args.amount} charged but not applied (${args.reason}) — needs a refund`,
  )
  await logAudit({
    tenantId: args.tenantId,
    userId: SYSTEM_USER,
    action: 'stripe_payment_needs_refund',
    tableName: args.tableName,
    recordId: args.recordId,
    changes: {
      reason: args.reason,
      amount: args.amount,
      session_id: args.stripeSessionId,
      payment_intent_id: args.stripePaymentIntentId,
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
