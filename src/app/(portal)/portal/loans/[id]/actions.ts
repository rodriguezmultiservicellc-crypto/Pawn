'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePortalCustomer } from '@/lib/portal/customer'
import {
  payoffFromLoan,
  todayDateString,
} from '@/lib/pawn/math'
import { createCheckoutSession } from '@/lib/stripe/payment-link'
import { logAudit } from '@/lib/audit'
import { insertStripeLink } from '@/lib/portal/stripe-payment-links'
import type {
  LoanEventRow,
  LoanRow,
  StripePaymentLinkInsert,
} from '@/types/database-aliases'
import type { PayoffActionResult } from './action-types'

/**
 * Create a Stripe Checkout Session for the current payoff balance on a loan
 * the active client owns. Returns the hosted Checkout URL — the client
 * component does window.location.assign() to it.
 *
 * Tenant + customer scoping is enforced via resolvePortalCustomer() (which
 * resolves the customer row via auth_user_id) and a sanity check that the
 * loan's customer_id matches.
 *
 * Idempotency-on-pending: we don't recycle existing pending sessions —
 * Stripe sessions expire in 24h, and we'd rather always have a fresh
 * payoff amount given accruing interest.
 */
export async function createLoanPayoffSession(args: {
  loanId: string
}): Promise<PayoffActionResult> {
  let portal
  try {
    portal = await resolvePortalCustomer()
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  const admin = createAdminClient()

  // Load the loan + events for live payoff calc.
  const loanLookup = await admin
    .from('loans')
    .select(
      `id, tenant_id, customer_id, ticket_number, principal,
       interest_rate_monthly, min_monthly_charge, issue_date, status,
       deleted_at,
       events:loan_events(principal_paid, interest_paid, fees_paid)`,
    )
    .eq('id', args.loanId)
    .maybeSingle()

  if (loanLookup.error || !loanLookup.data) {
    return { ok: false, error: 'not_found' }
  }

  type LoanWithEvents = LoanRow & {
    events?: Pick<
      LoanEventRow,
      'principal_paid' | 'interest_paid' | 'fees_paid'
    >[] | null
  }
  const loan = loanLookup.data as unknown as LoanWithEvents

  if (loan.deleted_at) return { ok: false, error: 'not_found' }
  if (loan.tenant_id !== portal.tenantId) return { ok: false, error: 'forbidden' }
  if (loan.customer_id !== portal.customerId) {
    return { ok: false, error: 'forbidden' }
  }
  if (
    loan.status === 'redeemed' ||
    loan.status === 'forfeited' ||
    loan.status === 'voided'
  ) {
    return { ok: false, error: 'closed' }
  }

  const events = loan.events ?? []
  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
      min_monthly_charge: loan.min_monthly_charge,
    },
    events,
    todayDateString(),
  )

  if (payoff.payoff <= 0) return { ok: false, error: 'closed' }

  let session
  try {
    session = await createCheckoutSession({
      tenantId: portal.tenantId,
      kind: 'loan_payoff',
      sourceId: loan.id,
      customerId: portal.customerId,
      amount: payoff.payoff,
      description: `Loan ${loan.ticket_number ?? ''} payoff`.trim(),
      returnPath: `/portal/loans/${loan.id}`,
      customerEmail: portal.customerEmail,
      metadata: {
        ticket_number: loan.ticket_number ?? '',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'stripe_failed'
    if (msg === 'tenant_stripe_not_connected') {
      return { ok: false, error: 'no_stripe' }
    }
    return { ok: false, error: 'stripe_failed' }
  }

  if (!session.url || !session.id) {
    return { ok: false, error: 'stripe_failed' }
  }

  // Persist a stripe_payment_links row so the webhook can match the
  // session back to a loan.
  const insert: StripePaymentLinkInsert = {
    tenant_id: portal.tenantId,
    source_kind: 'loan_payoff',
    source_id: loan.id,
    customer_id: portal.customerId,
    stripe_session_id: session.id,
    checkout_url: session.url,
    stripe_account_id: session.metadata?.stripe_account_id ?? null,
    amount: payoff.payoff,
    status: 'pending',
  }

  const linkRow = await insertStripeLink(insert)

  if (!linkRow) {
    // Don't fail the payment flow if our bookkeeping insert fails — the
    // webhook can still fall back to client_reference_id / metadata. Log it.
    console.error('[portal] stripe_payment_links insert failed for', session.id)
  } else {
    await logAudit({
      tenantId: portal.tenantId,
      userId: portal.userId,
      action: 'create',
      tableName: 'stripe_payment_links',
      recordId: linkRow.id,
      changes: {
        source_kind: 'loan_payoff',
        source_id: loan.id,
        amount: payoff.payoff,
      },
    })
  }

  return { ok: true, checkoutUrl: session.url }
}
