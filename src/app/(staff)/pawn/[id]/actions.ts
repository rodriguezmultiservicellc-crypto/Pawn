'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  loanForfeitSchema,
  loanFreeTimeSchema,
  loanPaymentSchema,
  loanVoidSchema,
} from '@/lib/validations/loan'
import { logAudit } from '@/lib/audit'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { chargeModelOf, loanForfeitEligibility, todayInTimezone } from '@/lib/jurisdictions/rules'
import {
  payoffFromLoan,
  planFreeTime,
  planLoanPayment,
  splitPayment,
  toMoney,
} from '@/lib/pawn/math'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  recordEarnLoanInterest,
  maybeCreditReferral,
} from '@/lib/loyalty/events'
import type { LoanStatus, PaymentMethod } from '@/types/database-aliases'

export type ActionResult = { error?: string; ok?: boolean }

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
      'id, tenant_id, customer_id, principal, interest_rate_monthly, min_monthly_charge, issue_date, due_date, status, is_printed',
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
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  const loanForPayoff = {
    principal: loan.principal,
    interest_rate_monthly: loan.interest_rate_monthly,
    issue_date: loan.issue_date,
    min_monthly_charge: loan.min_monthly_charge,
  }
  // The shop's day and the jurisdiction's way of charging — never UTC,
  // never a constant.
  const rules = await loadTenantRules(supabase, tenantId)
  const today = todayInTimezone(rules.timezone)
  const charge = chargeModelOf(rules)

  // What is owed right now, read by the server. The split and the new due
  // date are decided here and never taken from the browser — see
  // planLoanPayment for why.
  const { data: priorEvents, error: priorErr } = await supabase
    .from('loan_events')
    .select('principal_paid, interest_paid, fees_paid, interest_waived')
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
    })
    .select('id')
    .single()
  if (evErr || !paymentEvent) return { error: evErr?.message ?? 'insert_failed' }

  // Recompute payoff to decide next status.
  const { data: events } = await supabase
    .from('loan_events')
    .select('principal_paid, interest_paid, fees_paid, interest_waived')
    .eq('loan_id', loan.id)
  const payoff = payoffFromLoan(loanForPayoff, events ?? [], today, charge)

  let newStatus: LoanStatus = loan.status as LoanStatus
  let newDueDate: string | null = null
  if (payoff.payoff <= 0) {
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
    return { error: newDueDate ? 'due_date_not_moved' : 'status_not_updated' }
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
      old_due_date: loan.due_date,
      new_due_date: newDueDate,
      new_status: newStatus,
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
  return { ok: true }
}

// ── Free time (managers only) ───────────────────────────────────────────────

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
  const plan = planFreeTime(
    {
      principal: toMoney(loan.principal),
      monthlyRate: toMoney(loan.interest_rate_monthly),
      minMonthlyCharge: loan.min_monthly_charge,
      dueDate: loan.due_date,
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
    .select('principal_paid, interest_paid, fees_paid, interest_waived')
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

  // Apply remaining interest first, then remaining principal.
  const split = splitPayment(payoff.payoff, payoff.interestOutstanding)

  const { data: payoffEvent } = await supabase
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
      'id, description, category, metal_type, karat, weight_grams, jewelry_size, est_value, photo_path, position',
    )
    .eq('loan_id', loan.id)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  const createdInventoryIds: string[] = []
  for (const item of collateral ?? []) {
    const { data: inv, error: invErr } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        sku: '',
        sku_number: 0,
        description: item.description,
        category: item.category,
        metal: item.metal_type ?? null,
        karat: item.karat == null ? null : String(item.karat),
        weight_grams: item.weight_grams,
        jewelry_size: item.jewelry_size,
        cost_basis: item.est_value ?? 0,
        list_price: null,
        source: 'pawn_forfeit',
        source_loan_id: loan.id,
        acquired_at: todayInTimezone(rules.timezone),
        acquired_cost: item.est_value ?? 0,
        location: 'safe',
        status: 'available',
        notes: `Forfeited from ticket ${loan.id}`,
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

    // Re-link the photo by inserting a fresh inventory_item_photos row that
    // points at the same Storage path. The file is unchanged; ownership of
    // the path now spans both loan_collateral_items and inventory_item_photos
    // until the loan row is GC'd, but soft-delete is OK since loans never
    // hard-delete.
    if (item.photo_path) {
      await supabase.from('inventory_item_photos').insert({
        tenant_id: tenantId,
        item_id: inv.id,
        storage_path: item.photo_path,
        is_primary: true,
        position: 0,
        created_by: userId,
      })
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
