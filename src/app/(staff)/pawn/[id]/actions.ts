'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  loanExtensionSchema,
  loanForfeitSchema,
  loanPaymentSchema,
  loanVoidSchema,
} from '@/lib/validations/loan'
import { logAudit } from '@/lib/audit'
import {
  addDaysIso,
  payoffFromLoan,
  splitPayment,
  todayDateString,
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
async function resolveLoanScope(loanId: string) {
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
  const { supabase, userId } = await requireRoleInTenant(loan.tenant_id, STAFF_LOAN_ROLES)
  return { loan, supabase, userId, tenantId: loan.tenant_id }
}

function isTerminalStatus(status: LoanStatus): boolean {
  return status === 'redeemed' || status === 'forfeited' || status === 'voided'
}

// ── Record payment ──────────────────────────────────────────────────────────

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
    principal_paid: formData.get('principal_paid'),
    interest_paid: formData.get('interest_paid'),
    fees_paid: formData.get('fees_paid'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(v.loan_id)
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  // Insert event.
  const { data: paymentEvent, error: evErr } = await supabase
    .from('loan_events')
    .insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'payment',
      amount: v.amount,
      principal_paid: v.principal_paid,
      interest_paid: v.interest_paid,
      fees_paid: v.fees_paid,
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
    .select('principal_paid, interest_paid, fees_paid')
    .eq('loan_id', loan.id)
  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
      min_monthly_charge: loan.min_monthly_charge,
    },
    events ?? [],
    todayDateString(),
  )

  let newStatus: LoanStatus = loan.status as LoanStatus
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
  } else if (newStatus === 'active') {
    newStatus = 'partial_paid'
  }

  await supabase
    .from('loans')
    .update({ status: newStatus, updated_by: userId })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: 'payment',
      amount: v.amount,
      principal_paid: v.principal_paid,
      interest_paid: v.interest_paid,
      fees_paid: v.fees_paid,
      payment_method: v.payment_method,
      new_status: newStatus,
    },
  })

  // ── Loyalty earn on interest paid (gated) ──────────────────────────────
  if (loan.customer_id && Number(v.interest_paid) > 0) {
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
        interestPaid: Number(v.interest_paid),
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

// ── Extend ──────────────────────────────────────────────────────────────────

export async function extendLoanAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loanExtensionSchema.safeParse({
    loan_id: formData.get('loan_id'),
    new_term_days: formData.get('new_term_days'),
    interest_collected_now: formData.get('interest_collected_now'),
    payment_method: formData.get('payment_method'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { loan, supabase, userId, tenantId } = await resolveLoanScope(v.loan_id)
  if (isTerminalStatus(loan.status as LoanStatus)) {
    return { error: 'terminal_status' }
  }

  const today = todayDateString()
  const newDueDate = addDaysIso(today, v.new_term_days)

  // Optional interest collection.
  if (v.interest_collected_now > 0) {
    await supabase.from('loan_events').insert({
      loan_id: loan.id,
      tenant_id: tenantId,
      event_type: 'payment',
      amount: v.interest_collected_now,
      principal_paid: 0,
      interest_paid: v.interest_collected_now,
      fees_paid: 0,
      payment_method: (v.payment_method as PaymentMethod | null) ?? 'cash',
      performed_by: userId,
    })
  }

  // Extension event.
  await supabase.from('loan_events').insert({
    loan_id: loan.id,
    tenant_id: tenantId,
    event_type: 'extension',
    amount: null,
    principal_paid: 0,
    interest_paid: 0,
    fees_paid: 0,
    payment_method: null,
    new_due_date: newDueDate,
    notes: v.notes,
    performed_by: userId,
  })

  // Update loan terms. The print-immutability trigger allows term_days /
  // due_date when status transitions to 'extended'.
  const { error: upErr } = await supabase
    .from('loans')
    .update({
      due_date: newDueDate,
      term_days: v.new_term_days,
      status: 'extended' as LoanStatus,
      updated_by: userId,
    })
    .eq('id', loan.id)
    .eq('tenant_id', tenantId)
  if (upErr) return { error: upErr.message }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'loans',
    recordId: loan.id,
    changes: {
      kind: 'extension',
      new_due_date: newDueDate,
      new_term_days: v.new_term_days,
      interest_collected_now: v.interest_collected_now,
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
    .select('principal_paid, interest_paid, fees_paid')
    .eq('loan_id', loan.id)
  const payoff = payoffFromLoan(
    {
      principal: loan.principal,
      interest_rate_monthly: loan.interest_rate_monthly,
      issue_date: loan.issue_date,
      min_monthly_charge: loan.min_monthly_charge,
    },
    events ?? [],
    todayDateString(),
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
      'id, description, category, metal_type, karat, weight_grams, est_value, photo_path, position',
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
        cost_basis: item.est_value ?? 0,
        list_price: null,
        source: 'pawn_forfeit',
        source_loan_id: loan.id,
        acquired_at: todayDateString(),
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
