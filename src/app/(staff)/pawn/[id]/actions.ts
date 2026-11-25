'use server'

import { purityForInventory } from '@/lib/spot-prices/purity'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  loanForfeitSchema,
  loanFreeTimeSchema,
  loanPaymentSchema,
  loanPaymentsSchema,
  loanPaymentVoidSchema,
  loanVoidSchema,
} from '@/lib/validations/loan'
import { logAudit } from '@/lib/audit'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { chargeModelOf, loanForfeitEligibility, todayInTimezone } from '@/lib/jurisdictions/rules'
import {
  payoffFromLoan,
  planFreeTime,
  planLoanPayment,
  toMoney,
} from '@/lib/pawn/math'
import { inventoryDetailsFromCollateral } from '@/lib/pawn/forfeit-inventory'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  recordEarnClawback,
  recordEarnLoanInterest,
  maybeCreditReferral,
} from '@/lib/loyalty/events'
import { planPaymentVoid } from '@/lib/pawn/payment-void'
import type { LoanStatus, PaymentMethod } from '@/types/database-aliases'
import { allPhotoPaths } from '@/lib/uploads/intake-photos'

export type ActionResult = {
  error?: string
  ok?: boolean
  /** The payment just recorded: the screen prints its receipt. */
  eventId?: string
}

const STAFF_LOAN_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'chain_admin',
] as const

/**
 * Look up a loan and the tenant scope, then verify staff role at that tenant.
 * Mirrors the customer/inventory pattern in Phase 1.
 */
async function resolveLoanScope(
  loanId: string,
  roles: ReadonlyArray<(typeof STAFF_LOAN_ROLES)[number]> = STAFF_LOAN_ROLES,
) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: loan } = await ctx.supabase
    .from('loans')
    .select(
      'id, tenant_id, customer_id, principal, interest_rate_monthly, min_monthly_charge, issue_date, due_date, term_days, status, is_printed',
    )
    .eq('id', loanId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!loan) redirect('/pawn')
  const { supabase, userId } = await requireRoleInTenant(loan.tenant_id, roles)
  return { loan, supabase, userId, tenantId: loan.tenant_id }
}

function isTerminalStatus(status: LoanStatus): boolean {
  return status === 'redeemed' || status === 'forfeited' || status === 'voided'
}

// ── Payment (which may move the due date) ───────────────────────────────────

/**
 * Take a payment on a loan. Paying and extending are one act: the clerk says
 * how many periods the payment moves the due date (0 = it stays) and the
 * server decides everything else — the interest / principal split and the
 * new date, counted from the loan's CURRENT due date (planLoanPayment). The
 * date never moves on interest that was not paid.
 */
export async function recordPaymentAction(
  formData: FormData,
): Promise<ActionResult> {
  const loanIdRaw = formData.get('loan_id')
  if (typeof loanIdRaw !== 'string' || !loanIdRaw)
    return { error: 'missing_loan_id' }

  const parsed = loanPaymentSchema.safeParse({
    loan_id: loanIdRaw,
    amount: formData.get('amount'),
    payment_method: formData.get('payment_method') ?? 'cash',
    fees_paid: formData.get('fees_paid'),
    periods: formData.get('periods') ?? 0,
    new_due_date: formData.get('new_due_date') ?? undefined,
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    const feesIssue = parsed.error.issues.some(
      (i) => i.message === 'fees_exceed_amount',
    )
    return { error: feesIssue ? 'fees_exceed_amount' : 'validation_failed' }
  }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(v.loan_id)
  // The shop's day and the jurisdiction's way of charging — never UTC,
  // never a constant.
  const rules = await loadTenantRules(supabase, tenantId)
  const today = todayInTimezone(rules.timezone)
  const charge = chargeModelOf(rules)

  const planned = await planPayment({ supabase, loan, today, charge, input: v })
  if ('error' in planned) return { error: planned.error }
  return commitPayment({ supabase, userId, tenantId, loan, today, charge, input: v, plan: planned.plan, groupId: null })
}

type LoanScope = Awaited<ReturnType<typeof resolveLoanScope>>
type ScopedLoan = LoanScope['loan']
type OkPlan = Extract<ReturnType<typeof planLoanPayment>, { ok: true }>
/** One ticket's part of a payment, as the server takes it. */
type PaymentRequest = {
  amount: number
  payment_method: PaymentMethod
  fees_paid: number
  periods: number
  new_due_date?: string
  notes?: string | null
}

/**
 * What a payment on this loan does, read by the server against the loan's
 * live events: the split and the new due date are decided here and never
 * taken from the browser (planLoanPayment). Writes nothing.
 */
async function planPayment(args: {
  supabase: LoanScope['supabase']
  loan: ScopedLoan
  today: string
  charge: ReturnType<typeof chargeModelOf>
  input: PaymentRequest
}): Promise<{ plan: OkPlan } | { error: string }> {
  const { supabase, loan, today, charge, input: v } = args
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }
  const { data: priorEvents, error: priorErr } = await supabase
    .from('loan_events')
    .select('id, reverses_event_id, principal_paid, interest_paid, fees_paid, interest_waived, occurred_at')
    .eq('loan_id', loan.id)
  if (priorErr) return { error: 'payoff_unavailable' }
  const plan = planLoanPayment({
    principal: toMoney(loan.principal),
    monthlyRate: toMoney(loan.interest_rate_monthly),
    minMonthlyCharge: loan.min_monthly_charge,
    issueDate: loan.issue_date,
    dueDate: loan.due_date,
    events: priorEvents ?? [],
    charge,
    today,
    periods: v.periods,
    newDueDate: v.new_due_date ?? null,
    amount: v.amount,
    fees: v.fees_paid,
  })
  if (!plan.ok) {
    return {
      error:
        plan.reason === 'extension_underpaid'
          ? `extension_underpaid:${(plan.needed ?? 0).toFixed(2)}`
          : plan.reason,
    }
  }
  return { plan }
}

/**
 * Write a planned payment: the payment event, then what it did to the
 * ticket (redeemed / due date moved / partly paid), the audit row and the
 * loyalty earn. `groupId` links the payments of one "Pay together".
 */
async function commitPayment(args: {
  supabase: LoanScope['supabase']
  userId: string
  tenantId: string
  loan: ScopedLoan
  today: string
  charge: ReturnType<typeof chargeModelOf>
  input: PaymentRequest
  plan: OkPlan
  groupId: string | null
}): Promise<ActionResult> {
  const { supabase, userId, tenantId, loan, today, charge, input: v, plan, groupId } = args
  const loanForPayoff = {
    principal: loan.principal,
    interest_rate_monthly: loan.interest_rate_monthly,
    issue_date: loan.issue_date,
    min_monthly_charge: loan.min_monthly_charge,
  }

  // Insert event.
  const { data: paymentEvent, error: evErr } = await supabase
    .from('loan_events')
    .insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'payment',
      amount: v.amount,
      principal_paid: plan.principal_paid,
      interest_paid: plan.interest_paid,
      fees_paid: plan.fees_paid,
      payment_method: v.payment_method,
      notes: v.notes,
      performed_by: userId,
      payment_group_id: groupId,
    })
    .select('id')
    .single()
  if (evErr || !paymentEvent) return { error: evErr?.message ?? 'insert_failed' }

  // Recompute payoff to decide next status.
  const { data: events } = await supabase
    .from('loan_events')
    .select('id, reverses_event_id, principal_paid, interest_paid, fees_paid, interest_waived, occurred_at')
    .eq('loan_id', loan.id)
  const payoff = payoffFromLoan(loanForPayoff, events ?? [], today, charge)

  let newStatus: LoanStatus = loan.status as LoanStatus
  let newDueDate: string | null = null
  // Closed when nothing of the loan is left — not when the payoff is 0: a
  // customer who paid interest ahead can owe $0 today on an open loan.
  if (payoff.principalOutstanding <= 0) {
    newStatus = 'redeemed'
    await supabase.from('loan_events').insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'redemption',
      amount: null,
      principal_paid: 0,
      interest_paid: 0,
      fees_paid: 0,
      payment_method: null,
      performed_by: userId,
    })
  } else if (plan.new_due_date) {
    // The print-immutability trigger lets due_date change only while the
    // status is 'extended'.
    newStatus = 'extended'
    newDueDate = plan.new_due_date
  } else if (newStatus === 'active') {
    newStatus = 'partial_paid'
  }

  const { error: upErr } = await supabase
    .from('loans')
    .update(
      newDueDate
        ? { status: newStatus, due_date: newDueDate, updated_by: userId }
        : { status: newStatus, updated_by: userId },
    )
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)
  // The money is already on the ticket. Say exactly what did not happen.
  if (upErr) {
    console.error('[pawn.payment] loan update failed after payment', loan.id, upErr.message)
    revalidatePath(`/pawn/${loan.id}`)
    return {
      error: newDueDate ? 'due_date_not_moved' : 'status_not_updated',
      eventId: paymentEvent.id,
    }
  }

  if (newDueDate) {
    // Written after its payment: the receipt reads the new due date from
    // the extension that follows a payment.
    const { error: extErr } = await supabase.from('loan_events').insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'extension',
      amount: null,
      principal_paid: 0,
      interest_paid: 0,
      fees_paid: 0,
      payment_method: null,
      new_due_date: newDueDate,
      previous_due_date: loan.due_date,
      performed_by: userId,
    })
    if (extErr) {
      console.error('[pawn.payment] extension event insert failed', loan.id, extErr.message)
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: newDueDate ? 'payment_extension' : 'payment',
      amount: v.amount,
      principal_paid: plan.principal_paid,
      interest_paid: plan.interest_paid,
      fees_paid: plan.fees_paid,
      payment_method: v.payment_method,
      periods: newDueDate ? plan.periods : 0,
      // A date the clerk picked shows as 0 periods and its days.
      move_days: newDueDate ? plan.move_days : 0,
      old_due_date: loan.due_date,
      new_due_date: newDueDate,
      new_status: newStatus,
      ...(groupId ? { payment_group_id: groupId } : {}),
    },
  })

  // ── Loyalty earn on interest paid (gated) ──────────────────────────────
  if (loan.customer_id && plan.interest_paid > 0) {
    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('settings')
      .select(
        'loyalty_enabled, loyalty_earn_rate_loan_interest, loyalty_referral_bonus',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (settings?.loyalty_enabled) {
      await recordEarnLoanInterest({
        admin,
        tenantId,
        customerId: loan.customer_id,
        loanEventId: paymentEvent.id,
        interestPaid: plan.interest_paid,
        rate: Number(settings.loyalty_earn_rate_loan_interest),
      })
      await maybeCreditReferral({
        admin,
        tenantId,
        customerId: loan.customer_id,
        bonusPoints: settings.loyalty_referral_bonus,
      })
    }
  }

  revalidatePath(`/pawn/${loan.id}`)
  revalidatePath('/pawn')
  return { ok: true, eventId: paymentEvent.id }
}

// ── Pay together: several tickets of one customer in one visit ──────────────

export type PayTogetherResult = {
  ok?: boolean
  /** The combined receipt reads the payments by this id. */
  groupId?: string
  /** A ticket the server refused, with why — nothing was written. */
  refused?: { loanId: string; error: string }
  /** Set when a write failed part way: these tickets WERE paid. */
  savedLoanIds?: string[]
  error?: string
}

/**
 * Take a payment on several tickets of the same customer at once: one
 * payment method, one receipt. Each ticket gets its own payment event, split
 * and due-date move, decided by the same planPayment / commitPayment as a
 * single payment.
 *
 * Every ticket is planned BEFORE anything is written: one ticket that would
 * be refused (underpaid move, more than its payoff, closed) refuses the
 * whole visit and nothing is saved. A database failure part way through
 * cannot be undone from here, so it says exactly which tickets were paid.
 */
export async function recordPaymentsAction(input: unknown): Promise<PayTogetherResult> {
  const parsed = loanPaymentsSchema.safeParse(input)
  if (!parsed.success) {
    const feesIssue = parsed.error.issues.some((i) => i.message === 'fees_exceed_amount')
    return { error: feesIssue ? 'fees_exceed_amount' : 'validation_failed' }
  }
  const v = parsed.data
  const ids = v.payments.map((p) => p.loan_id)
  if (new Set(ids).size !== ids.length) return { error: 'validation_failed' }

  const scopes: LoanScope[] = []
  for (const id of ids) scopes.push(await resolveLoanScope(id))
  const { supabase, userId, tenantId } = scopes[0]
  // One customer, one shop: the receipt is that customer's.
  if (scopes.some((s) => s.tenantId !== tenantId || s.loan.customer_id !== scopes[0].loan.customer_id)) {
    return { error: 'mixed_customers' }
  }

  const rules = await loadTenantRules(supabase, tenantId)
  const today = todayInTimezone(rules.timezone)
  const charge = chargeModelOf(rules)

  const plans: Array<{ scope: LoanScope; req: PaymentRequest; plan: OkPlan }> = []
  for (let i = 0; i < scopes.length; i++) {
    const p = v.payments[i]
    const req: PaymentRequest = {
      amount: p.amount,
      payment_method: v.payment_method,
      fees_paid: p.fees_paid,
      periods: p.periods,
      new_due_date: p.new_due_date,
      notes: v.notes,
    }
    const planned = await planPayment({ supabase, loan: scopes[i].loan, today, charge, input: req })
    if ('error' in planned) return { refused: { loanId: p.loan_id, error: planned.error } }
    plans.push({ scope: scopes[i], req, plan: planned.plan })
  }

  const groupId = crypto.randomUUID()
  const saved: string[] = []
  for (const { scope, req, plan } of plans) {
    const res = await commitPayment({
      supabase,
      userId,
      tenantId,
      loan: scope.loan,
      today,
      charge,
      input: req,
      plan,
      groupId,
    })
    // The payment event is written first: a later step failing still means
    // this ticket was paid.
    if (res.eventId) saved.push(scope.loan.id)
    if (res.error) {
      console.error('[pawn.payTogether] stopped part way', scope.loan.id, res.error)
      return { error: 'partly_saved', savedLoanIds: saved, groupId: saved.length ? groupId : undefined }
    }
  }

  revalidatePath('/pawn')
  return { ok: true, groupId }
}

// ── Free time (managers only)───────────────────────────────────────────────

/** Who may give a customer free time: the people who answer for the money. */
const FREE_TIME_ROLES = ['owner', 'manager', 'chain_admin'] as const

/**
 * A manager gives a customer free time on a ticket: the due date moves, from
 * the loan's CURRENT due date, and the interest for those days is forgiven
 * (loan_events.interest_waived — a credit, never income). No money is taken.
 *
 * A clerk cannot do this: the role is checked here, whatever the page shows.
 * The days and the forgiven amount are worked out by the server
 * (planFreeTime); the browser only says how long.
 */
export async function giveFreeTimeAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loanFreeTimeSchema.safeParse({
    loan_id: formData.get('loan_id'),
    quantity: formData.get('quantity'),
    unit: formData.get('unit'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(
    v.loan_id,
    FREE_TIME_ROLES,
  )
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  const rules = await loadTenantRules(supabase, tenantId)
  const charge = chargeModelOf(rules)
  const days = v.unit === 'periods' ? v.quantity * charge.periodDays : v.quantity
  // What was paid toward the loan: the charge forgiven is the one on the
  // balance still owed.
  const { data: paidEvents, error: paidErr } = await supabase
    .from('loan_events')
    .select('id, reverses_event_id, principal_paid, interest_paid, fees_paid, interest_waived, occurred_at')
    .eq('loan_id', loan.id)
    .eq('tenant_id', tenantId)
  if (paidErr) return { error: paidErr.message }
  const plan = planFreeTime(
    {
      principal: toMoney(loan.principal),
      monthlyRate: toMoney(loan.interest_rate_monthly),
      minMonthlyCharge: loan.min_monthly_charge,
      dueDate: loan.due_date,
      events: paidEvents ?? [],
      charge,
    },
    days,
  )
  if (!plan) return { error: 'too_long' }

  // The gift first, then the date: if the second step failed, the customer
  // would still not be charged for time a manager gave them.
  const { error: evErr } = await supabase.from('loan_events').insert({
    loan_id: loan.id,
    tenant_id: tenantId,
    event_type: 'extension',
    amount: null,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    interest_waived: plan.interest_waived,
    payment_method: null,
    new_due_date: plan.new_due_date,
    previous_due_date: loan.due_date,
    notes: v.notes,
    performed_by: userId,
  })
  if (evErr) return { error: evErr.message }

  // The print-immutability trigger lets due_date change only while the
  // status is 'extended'.
  const { error: upErr } = await supabase
    .from('loans')
    .update({
      due_date: plan.new_due_date,
      status: 'extended' as LoanStatus,
      updated_by: userId,
    })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)
  if (upErr) {
    console.error('[pawn.freeTime] loan update failed after the waiver', loan.id, upErr.message)
    revalidatePath(`/pawn/${loan.id}`)
    return { error: 'due_date_not_moved' }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: 'free_time',
      days: plan.days,
      interest_waived: plan.interest_waived,
      old_due_date: loan.due_date,
      new_due_date: plan.new_due_date,
      notes: v.notes ?? null,
    },
  })

  revalidatePath(`/pawn/${loan.id}`)
  revalidatePath('/pawn')
  return { ok: true }
}

// ── Void ONE payment ────────────────────────────────────────────────────────

/** The database's refusals (trigger in patches/0104), as the screen's codes. */
const VOID_DB_ERRORS: ReadonlyArray<[string, string]> = [
  ['payment_void_imported', 'imported'],
  ['payment_void_online', 'online'],
  ['payment_void_not_exact', 'void_failed'],
  ['payment_void_other_loan', 'not_found'],
  ['payment_void_not_found', 'not_found'],
  ['payment_void_not_a_payment', 'not_a_payment'],
  ['payment_void_of_a_void', 'not_a_payment'],
  ['uq_loan_events_reverses', 'already_voided'],
]

/**
 * A manager voids ONE payment — the last one on the ticket. Nothing is
 * edited or deleted: a reversal row is written beside it (the same money,
 * negative), and for what the customer owes both are then ignored. The due
 * date goes back if that payment moved it, and a ticket that payment paid
 * off is open again.
 *
 * Owner / manager only, like free time: undoing a payment after the cash is
 * in the drawer is not a clerk's call. What it undoes is decided by
 * planPaymentVoid; the browser only says which payment and why.
 */
export async function voidPaymentAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loanPaymentVoidSchema.safeParse({
    loan_id: formData.get('loan_id'),
    event_id: formData.get('event_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(
    v.loan_id,
    FREE_TIME_ROLES,
  )

  const { data: events, error: evErr } = await supabase
    .from('loan_events')
    .select(
      'id, event_type, occurred_at, amount, principal_paid, interest_paid, fees_paid, interest_waived, payment_method, new_due_date, previous_due_date, reverses_event_id, legacy_ref, stripe_session_id',
    )
    .eq('loan_id', loan.id)
    .eq('tenant_id', tenantId)
  if (evErr) return { error: 'void_failed' }

  const plan = planPaymentVoid({
    loan: {
      status: loan.status as LoanStatus,
      due_date: loan.due_date,
      issue_date: loan.issue_date,
      term_days: loan.term_days,
    },
    events: events ?? [],
    eventId: v.event_id,
  })
  if (!plan.ok) return { error: plan.reason }

  // 1. The reversal. From here on the payment no longer counts.
  const { data: reversal, error: revErr } = await supabase
    .from('loan_events')
    .insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'payment',
      amount: plan.reversal.amount,
      principal_paid: plan.reversal.principal_paid,
      interest_paid: plan.reversal.interest_paid,
      fees_paid: plan.reversal.fees_paid,
      payment_method: plan.reversal.payment_method,
      reverses_event_id: v.event_id,
      notes: v.reason,
      performed_by: userId,
    })
    .select('id')
    .single()
  if (revErr || !reversal) {
    const hit = VOID_DB_ERRORS.find(([needle]) => revErr?.message?.includes(needle))
    console.error('[pawn.voidPayment] reversal refused', loan.id, revErr?.message)
    return { error: hit ? hit[1] : 'void_failed' }
  }

  // 2. The due date and the status that payment had set. The money is
  // already right; say exactly what did not go back if a step fails.
  let stepFailed: 'void_due_date_not_restored' | 'void_status_not_restored' | null = null
  if (plan.restoreDueDate) {
    // The print-immutability trigger lets due_date change only while the
    // status is 'extended'.
    const { error: dueErr } = await supabase
      .from('loans')
      .update({ status: 'extended' as LoanStatus, due_date: plan.restoreDueDate, updated_by: userId })
      .eq('id', loan.id)
      .eq('tenant_id', tenantId)
    if (dueErr) {
      console.error('[pawn.voidPayment] due date not restored', loan.id, dueErr.message)
      stepFailed = 'void_due_date_not_restored'
    } else {
      const { error: backErr } = await supabase.from('loan_events').insert({
        loan_id: loan.id,
        tenant_id: tenantId,
        event_type: 'extension',
        amount: null,
        principal_paid: 0,
        interest_paid: 0,
        fees_paid: 0,
        payment_method: null,
        new_due_date: plan.restoreDueDate,
        previous_due_date: loan.due_date,
        performed_by: userId,
      })
      if (backErr) {
        console.error('[pawn.voidPayment] due-date row insert failed', loan.id, backErr.message)
      }
    }
  }
  const statusNow = plan.restoreDueDate && !stepFailed ? 'extended' : (loan.status as LoanStatus)
  if (!stepFailed && plan.newStatus !== statusNow) {
    const { error: stErr } = await supabase
      .from('loans')
      .update({ status: plan.newStatus as LoanStatus, updated_by: userId })
      .eq('id', loan.id)
      .eq('tenant_id', tenantId)
    if (stErr) {
      console.error('[pawn.voidPayment] status not restored', loan.id, stErr.message)
      stepFailed = 'void_status_not_restored'
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: 'payment_void',
      voided_event_id: v.event_id,
      reversal_event_id: reversal.id,
      amount: -plan.reversal.amount,
      principal_paid: -plan.reversal.principal_paid,
      interest_paid: -plan.reversal.interest_paid,
      fees_paid: -plan.reversal.fees_paid,
      reason: v.reason,
      old_due_date: loan.due_date,
      restored_due_date: plan.restoreDueDate,
      reopened: plan.reopens,
      old_status: loan.status,
      new_status: stepFailed ? loan.status : plan.newStatus,
      incomplete: stepFailed,
    },
  })

  // Loyalty points earned on that payment's interest come back (gated: only
  // if any were written for it).
  if (loan.customer_id) {
    const admin = createAdminClient()
    const { data: earned } = await admin
      .from('loyalty_events')
      .select('points_delta')
      .eq('tenant_id', tenantId)
      .eq('customer_id', loan.customer_id)
      .eq('source_kind', 'loan_event')
      .eq('source_id', v.event_id)
      .eq('kind', 'earn_loan_interest')
      .maybeSingle()
    const points = Number(earned?.points_delta ?? 0)
    if (points > 0) {
      await recordEarnClawback({
        admin,
        tenantId,
        customerId: loan.customer_id,
        sourceKind: 'loan_event',
        sourceId: v.event_id,
        pointsToClaw: points,
        reason: 'loan_payment_voided',
      })
    }
  }

  revalidatePath(`/pawn/${loan.id}`)
  revalidatePath('/pawn')
  return stepFailed ? { error: stepFailed } : { ok: true }
}

// ── Redeem (full payoff) ────────────────────────────────────────────────────

export async function redeemLoanAction(
  formData: FormData,
): Promise<ActionResult> {
  const loanId = formData.get('loan_id')
  if (typeof loanId !== 'string' || !loanId) return { error: 'missing_loan_id' }
  const methodRaw = String(formData.get('payment_method') ?? 'cash')
  const method: PaymentMethod =
    methodRaw === 'cash' ||
    methodRaw === 'card' ||
    methodRaw === 'check' ||
    methodRaw === 'other'
      ? methodRaw
      : 'cash'

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(loanId)
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  const { data: events } = await supabase
    .from('loan_events')
    .select('id, reverses_event_id, principal_paid, interest_paid, fees_paid, interest_waived, occurred_at')
    .eq('loan_id', loan.id)
  // Interest is owed through the shop's day, not UTC's.
  const redeemRules = await loadTenantRules(supabase, tenantId)
  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
      min_monthly_charge: loan.min_monthly_charge,
    },
    events ?? [],
    todayInTimezone(redeemRules.timezone),
    chargeModelOf(redeemRules),
  )

  // The payoff is the principal still owed plus the interest owed — or
  // LESS the interest the customer paid ahead and did not use, which this
  // event gives back as negative interest (§ 539.001(11)(c)).
  const split = {
    principal_paid: payoff.principalOutstanding,
    interest_paid: toMoney(payoff.payoff - payoff.principalOutstanding),
  }

  const { data: payoffEvent, error: payoffErr } = await supabase
    .from('loan_events')
    .insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'payment',
      amount: payoff.payoff,
      principal_paid: split.principal_paid,
      interest_paid: split.interest_paid,
      fees_paid: 0,
      payment_method: method,
      performed_by: userId,
    })
    .select('id')
    .single()
  // No payment on the ticket, no redemption: never close a loan on money
  // that was not recorded.
  if (payoffErr || !payoffEvent) return { error: payoffErr?.message ?? 'insert_failed' }

  await supabase.from('loan_events').insert({
    loan_id: loan.id,
    tenant_id: tenantId,
    event_type: 'redemption',
    amount: null,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    payment_method: null,
    performed_by: userId,
  })

  await supabase
    .from('loans')
    .update({ status: 'redeemed' as LoanStatus, updated_by: userId })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: 'redemption',
      payoff: payoff.payoff,
      interest_paid_ahead_credited: payoff.interestPaidAhead,
      payment_method: method,
    },
  })

  // ── Loyalty earn on interest paid + referral credit (gated) ────────────
  if (loan.customer_id && payoffEvent && split.interest_paid > 0) {
    const admin = createAdminClient()
    const { data: settings } = await admin
      .from('settings')
      .select(
        'loyalty_enabled, loyalty_earn_rate_loan_interest, loyalty_referral_bonus',
      )
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (settings?.loyalty_enabled) {
      await recordEarnLoanInterest({
        admin,
        tenantId,
        customerId: loan.customer_id,
        loanEventId: payoffEvent.id,
        interestPaid: split.interest_paid,
        rate: Number(settings.loyalty_earn_rate_loan_interest),
      })
      await maybeCreditReferral({
        admin,
        tenantId,
        customerId: loan.customer_id,
        bonusPoints: settings.loyalty_referral_bonus,
      })
    }
  }

  revalidatePath(`/pawn/${loan.id}`)
  revalidatePath('/pawn')
  return { ok: true }
}

// ── Forfeit (-> inventory) ──────────────────────────────────────────────────

export async function forfeitLoanAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loanForfeitSchema.safeParse({
    loan_id: formData.get('loan_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(v.loan_id)
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  // Statutory grace (patches/0048): forfeiture only after maturity + grace,
  // evaluated in the shop's timezone. The loans trigger enforces the same.
  const rules = await loadTenantRules(supabase, tenantId)
  const eligibility = loanForfeitEligibility(rules, loan.due_date)
  if (!eligibility.eligible) {
    return { error: `forfeit_not_eligible_until:${eligibility.eligibleOn}` }
  }

  // Update loan -> forfeited.
  const { error: upErr } = await supabase
    .from('loans')
    .update({ status: 'forfeited' as LoanStatus, updated_by: userId })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)
  if (upErr) return { error: upErr.message }

  // Forfeit event.
  await supabase.from('loan_events').insert({
    loan_id: loan.id,
    tenant_id: tenantId,
    event_type: 'forfeiture',
    amount: null,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    payment_method: null,
    notes: v.notes,
    performed_by: userId,
  })

  // Convert each collateral item into an inventory_items row + relink the
  // photo via inventory_item_photos.
  const { data: collateral } = await supabase
    .from('loan_collateral_items')
    .select(
      `id, description, category, metal_type, karat, weight_grams, jewelry_size, est_value, photo_path, extra_photo_paths, position,
       coating, stones, gemstone_notes,
       jewelry_brand, jewelry_model, jewelry_serial,
       electronic_brand, electronic_model, electronic_serial,
       tool_brand, tool_model, tool_serial,
       general_brand, general_model, general_serial,
       firearm_make, firearm_model, firearm_serial_number`,
    )
    .eq('loan_id', loan.id)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const createdInventoryIds: string[] = []
  for (const item of collateral ?? []) {
    // What the ticket knew about the piece beyond its description: brand,
    // model, serial, coating, stones (lib/pawn/forfeit-inventory).
    const details = inventoryDetailsFromCollateral(item)
    const { data: inv, error: invErr } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        sku: '',
        sku_number: 0,
        description: item.description,
        category: item.category,
        metal: item.metal_type ?? null,
        // As inventory keeps it: "14K", "925".
        karat: purityForInventory(item.metal_type, item.karat),
        weight_grams: item.weight_grams,
        jewelry_size: item.jewelry_size,
        coating: details.coating,
        brand: details.brand,
        model: details.model,
        serial_number: details.serial_number,
        cost_basis: item.est_value ?? 0,
        list_price: null,
        source: 'pawn_forfeit',
        source_loan_id: loan.id,
        acquired_at: todayInTimezone(rules.timezone),
        acquired_cost: item.est_value ?? 0,
        location: 'safe',
        status: 'available',
        notes: details.stoneNotes
          ? `Forfeited from ticket ${loan.id}. Stones: ${details.stoneNotes}`
          : `Forfeited from ticket ${loan.id}`,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .single()

    if (invErr || !inv) {
      console.error(
        '[pawn.forfeit] inventory insert failed for collateral',
        item.id,
        invErr?.message,
      )
      continue
    }

    createdInventoryIds.push(inv.id)

    // The stones written at the counter, one inventory stone per line.
    if (details.stones.length > 0) {
      const { error: stoneErr } = await supabase.from('inventory_item_stones').insert(
        details.stones.map((st) => ({
          tenant_id: tenantId,
          item_id: inv.id,
          position: st.position,
          count: st.count,
          stone_type: st.stone_type,
          carat: st.carat,
          is_total_carat: true,
          color: st.color,
          cut: st.cut,
          clarity: st.clarity,
        })),
      )
      if (stoneErr) {
        console.error('[pawn.forfeit] stones insert failed for collateral', item.id, stoneErr.message)
      }
    }

    // Re-link EVERY photo (main first, patches/0114) by inserting fresh
    // inventory_item_photos rows that point at the same Storage paths. The
    // files are unchanged; ownership of a path now spans both
    // loan_collateral_items and inventory_item_photos, which is fine since
    // loans never hard-delete.
    const photos = allPhotoPaths(item)
    if (photos.length > 0) {
      await supabase.from('inventory_item_photos').insert(
        photos.map((path, position) => ({
          tenant_id: tenantId,
          item_id: inv.id,
          storage_path: path,
          is_primary: position === 0,
          position,
          created_by: userId,
        })),
      )
    }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: 'forfeit',
      created_inventory_ids: createdInventoryIds,
      collateral_count: (collateral ?? []).length,
      notes: v.notes ?? null,
    },
  })

  revalidatePath(`/pawn/${loan.id}`)
  revalidatePath('/pawn')
  revalidatePath('/inventory')
  return { ok: true }
}

// ── Void ────────────────────────────────────────────────────────────────────

export async function voidLoanAction(formData: FormData): Promise<ActionResult> {
  const parsed = loanVoidSchema.safeParse({
    loan_id: formData.get('loan_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(v.loan_id)
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  const { error: upErr } = await supabase
    .from('loans')
    .update({ status: 'voided' as LoanStatus, updated_by: userId })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)
  if (upErr) return { error: upErr.message }

  await supabase.from('loan_events').insert({
    loan_id: loan.id,
    tenant_id: tenantId,
    event_type: 'void',
    amount: null,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    payment_method: null,
    notes: v.reason,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: { kind: 'void', reason: v.reason },
  })

  revalidatePath(`/pawn/${loan.id}`)
  revalidatePath('/pawn')
  return { ok: true }
}

// ── Print ticket (lock core fields) ────────────────────────────────────────

export async function printTicketAction(loanId: string): Promise<ActionResult> {
  if (!loanId) return { error: 'missing_loan_id' }
  const { loan, supabase, userId, tenantId } = await resolveLoanScope(loanId)

  if (loan.is_printed) {
    return { ok: true } // already locked; silent no-op
  }

  const { error } = await supabase
    .from('loans')
    .update({
      is_printed: true,
      printed_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: { kind: 'print', is_printed: true },
  })

  revalidatePath(`/pawn/${loan.id}`)
  return { ok: true }
}

// Suppress lint on unused import — toMoney is exposed from this module to
// keep the surface consistent for future actions (e.g., partial split helper).
void toMoney
