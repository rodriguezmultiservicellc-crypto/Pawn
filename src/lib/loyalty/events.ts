// src/lib/loyalty/events.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  computeRetailEarn,
  computeLoanInterestEarn,
  generateReferralCode,
  isValidReferralCode,
  clampClawback,
} from './math'

type AdminClient = SupabaseClient<Database>

type EventInsert = Database['public']['Tables']['loyalty_events']['Insert']

/**
 * Internal: insert a loyalty_events row. The AFTER INSERT trigger updates
 * customers.loyalty_points_balance. CHECK (>= 0) is the safety net — a
 * delta that would drop balance below zero rolls back.
 *
 * Returns a discriminated union so callers can distinguish three outcomes:
 *   - { ok: true, id } — row was actually inserted.
 *   - { ok: 'collision' } — partial-unique index blocked a duplicate
 *     (idempotency hit). Treat as success-no-op for indexed kinds.
 *   - { ok: false, error } — real insert failure. Callers decide whether
 *     to surface or log-and-continue.
 */
type InsertResult =
  | { ok: true; id: string }
  | { ok: 'collision' }
  | { ok: false; error: string }

async function insertEvent(
  admin: AdminClient,
  row: EventInsert,
): Promise<InsertResult> {
  const { data, error } = await admin
    .from('loyalty_events')
    .insert(row)
    .select('id')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      // Idempotency hit — partial-unique index blocked a duplicate.
      return { ok: 'collision' }
    }
    console.error('[loyalty.events] insert failed', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, id: data.id }
}

// ── Earn helpers ─────────────────────────────────────────────────────────

export async function recordEarnSale(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  saleId: string
  subtotal: number
  rate: number
}): Promise<void> {
  const points = computeRetailEarn(args.subtotal, args.rate)
  if (points <= 0) return
  await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'earn_sale',
    points_delta: points,
    source_kind: 'sale',
    source_id: args.saleId,
  })
}

export async function recordEarnLoanInterest(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  loanEventId: string
  interestPaid: number
  rate: number
}): Promise<void> {
  const points = computeLoanInterestEarn(args.interestPaid, args.rate)
  if (points <= 0) return
  await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'earn_loan_interest',
    points_delta: points,
    source_kind: 'loan_event',
    source_id: args.loanEventId,
  })
}

// ── Referral ─────────────────────────────────────────────────────────────

export async function maybeCreditReferral(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  bonusPoints: number
}): Promise<void> {
  if (args.bonusPoints <= 0) return
  const { data: customer } = await args.admin
    .from('customers')
    .select('referred_by_customer_id, referral_credited')
    .eq('id', args.customerId)
    .maybeSingle()
  if (!customer?.referred_by_customer_id) return
  if (customer.referral_credited) return

  const result = await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: customer.referred_by_customer_id,
    kind: 'earn_referral_bonus',
    points_delta: args.bonusPoints,
    source_kind: 'referral',
    source_id: args.customerId,
  })
  // Flip the flag only when the bonus has actually been credited at some
  // point in this row's lifetime — either we just wrote the row, or a prior
  // call did and the unique index blocked us. On real failure (ok: false),
  // leave the flag at false so a future call can retry; insertEvent already
  // logged the error.
  if (result.ok === true || result.ok === 'collision') {
    await args.admin
      .from('customers')
      .update({ referral_credited: true })
      .eq('id', args.customerId)
  }
}

// ── Redemption helpers ───────────────────────────────────────────────────

export async function recordRedemption(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  saleId: string
  pointsConsumed: number
  performedBy: string
}): Promise<{ id: string } | null> {
  if (args.pointsConsumed <= 0) return null
  const result = await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'redeem_pos',
    points_delta: -args.pointsConsumed,
    source_kind: 'sale',
    source_id: args.saleId,
    performed_by: args.performedBy,
  })
  if (result.ok === true) return { id: result.id }
  // Collision → row already exists; carry on as success-no-op.
  // Failure → already logged; surface as null per caller contract.
  return null
}

export async function recordRedeemUndo(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  originalEventId: string
  saleId: string
  pointsToRestore: number
  reason: string
  performedBy: string | null
}): Promise<void> {
  if (args.pointsToRestore <= 0) return
  await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'redeem_undo',
    points_delta: args.pointsToRestore,
    source_kind: 'sale',
    source_id: args.saleId,
    reason: args.reason,
    performed_by: args.performedBy,
  })
  void args.originalEventId // logged via reason if needed; kept for future expansion
}

// ── Clawback ─────────────────────────────────────────────────────────────

export async function recordEarnClawback(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  sourceKind: 'sale' | 'return'
  sourceId: string
  pointsToClaw: number
  reason: 'sale_voided' | 'sale_returned'
}): Promise<void> {
  // Read current balance so we can clamp.
  const { data: customer } = await args.admin
    .from('customers')
    .select('loyalty_points_balance')
    .eq('id', args.customerId)
    .maybeSingle()
  const currentBalance = customer?.loyalty_points_balance ?? 0

  const clampedPoints = clampClawback({
    pointsToClaw: args.pointsToClaw,
    currentBalance,
  })
  if (clampedPoints <= 0) return

  await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'earn_clawback',
    points_delta: -clampedPoints,
    source_kind: args.sourceKind,
    source_id: args.sourceId,
    reason: args.reason,
  })
}

// ── Manual adjust ────────────────────────────────────────────────────────

export async function recordManualAdjust(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  delta: number
  reason: string
  performedBy: string
}): Promise<{ ok: true } | { error: 'reason_too_short' | 'would_go_negative' | 'insert_failed' }> {
  if (!args.reason || args.reason.trim().length < 3) {
    return { error: 'reason_too_short' }
  }
  // Read current balance so we can pre-check the negative-balance path
  // without relying on the CHECK constraint to surface a useful error.
  const { data: customer } = await args.admin
    .from('customers')
    .select('loyalty_points_balance')
    .eq('id', args.customerId)
    .maybeSingle()
  const currentBalance = customer?.loyalty_points_balance ?? 0
  if (currentBalance + args.delta < 0) {
    return { error: 'would_go_negative' }
  }
  const result = await insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'adjust_manual',
    points_delta: args.delta,
    reason: args.reason.trim(),
    performed_by: args.performedBy,
  })
  if (result.ok === false) return { error: 'insert_failed' }
  // adjust_manual isn't in the idempotency partial-unique index, so a
  // 'collision' shouldn't occur — but treat it as success if it ever does.
  return { ok: true }
}

// ── Referral code ────────────────────────────────────────────────────────

/**
 * Idempotent: returns the existing code if one is set; otherwise generates
 * one (retrying on UNIQUE collision up to 5 attempts) and persists it.
 */
export async function ensureReferralCode(
  admin: AdminClient,
  customerId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('customers')
    .select('referral_code')
    .eq('id', customerId)
    .maybeSingle()
  if (existing?.referral_code) return existing.referral_code

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode(Math.random)
    const { data: updated, error } = await admin
      .from('customers')
      .update({ referral_code: code })
      .eq('id', customerId)
      .is('referral_code', null)
      .select('referral_code')
      .maybeSingle()

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        // UNIQUE collision on referral_code — retry with a fresh code.
        continue
      }
      // Unrelated error — surface the real message so ops sees it.
      throw new Error(`ensureReferralCode failed: ${error.message}`)
    }

    if (updated?.referral_code) {
      // Affected one row, our code stuck.
      return updated.referral_code
    }

    // 0 rows affected — someone else set it concurrently. Re-read.
    const { data: after } = await admin
      .from('customers')
      .select('referral_code')
      .eq('id', customerId)
      .maybeSingle()
    if (after?.referral_code) return after.referral_code
    // Re-read returned no code either — retry the loop.
  }
  throw new Error('referral_code_generation_failed_after_5_attempts')
}

/**
 * Resets a customer's referral_code by clearing it. The next caller of
 * ensureReferralCode generates a new one. Already-credited referrals
 * (referred_by_customer_id on other customers + referral_credited TRUE)
 * are NOT affected — those events are immutable.
 */
export async function resetReferralCode(
  admin: AdminClient,
  customerId: string,
): Promise<string> {
  await admin
    .from('customers')
    .update({ referral_code: null })
    .eq('id', customerId)
  return ensureReferralCode(admin, customerId)
}

/**
 * Look up referrer by code (per tenant) and link to the new customer.
 * Silent no-op when code doesn't match — staff can correct later via the
 * customer detail page. Don't block customer creation on a bad code.
 */
export async function applyReferredByCode(args: {
  admin: AdminClient
  tenantId: string
  newCustomerId: string
  code: string
}): Promise<void> {
  const code = args.code.trim().toUpperCase()
  if (!isValidReferralCode(code)) return
  const { data: referrer } = await args.admin
    .from('customers')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('referral_code', code)
    .maybeSingle()
  if (!referrer) return
  if (referrer.id === args.newCustomerId) return // self-referral guard
  // Only set if not already set — a second call (or concurrent caller) is
  // a no-op rather than overwriting an established referral link.
  await args.admin
    .from('customers')
    .update({ referred_by_customer_id: referrer.id })
    .eq('id', args.newCustomerId)
    .is('referred_by_customer_id', null)
}
