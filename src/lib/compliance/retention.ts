/**
 * Customer-record retention rules per CLAUDE.md Rule 13.
 *
 * A customer record may not be deleted while:
 *   - any loan is still open, OR
 *   - the jurisdiction's record-retention window after the most recent
 *     closed (redeemed / forfeited) loan has not expired, OR
 *   - the same window after the most recent buy-outright has not expired
 *     (the pawnbroker transaction form covers purchases too), OR
 *   - any repair ticket is in flight, OR
 *   - any layaway is active.
 *
 * The retention period comes from jurisdictions.record_retention_years
 * (patches/0048; FL = 3 years, Fla. Stat. § 539.001(12)(c)). Tenants with
 * no jurisdiction on file have no statutory window — only the open-work
 * checks apply.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { EffectiveRules } from '@/lib/jurisdictions/rules'

export type DeleteBlockReason =
  | 'active_loan'
  | 'pawn_retention_window'
  | 'buy_retention_window'
  | 'active_repair'
  | 'active_layaway'
  // Money the shop still owes this person. Deleting the record would erase
  // the debt (patches/0053-0054).
  | 'unspent_store_credit'
  | 'open_consignment'

export type CanDeleteCustomerResult =
  | { canDelete: true }
  | {
      canDelete: false
      reasons: ReadonlyArray<DeleteBlockReason>
      /** ISO date the LATEST retention window expires (the record can be
       *  deleted after this). Null when every reason is open-ended (e.g. an
       *  active loan). */
      blockedUntil: string | null
    }

function addYearsIso(ts: string, years: number): string {
  const d = new Date(ts)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}

/**
 * Determine whether a customer record may be deleted today. Pure reads
 * against tenant-scoped tables; the caller has already gated by role.
 */
export async function canDeleteCustomer(args: {
  supabase: SupabaseClient<Database>
  customerId: string
  tenantId: string
  rules: EffectiveRules
}): Promise<CanDeleteCustomerResult> {
  const { supabase, customerId, tenantId, rules } = args
  const today = new Date().toISOString().slice(0, 10)
  const years = rules.retentionYears
  const reasons: DeleteBlockReason[] = []
  let blockedUntil: string | null = null
  const extend = (iso: string) => {
    blockedUntil = blockedUntil != null && blockedUntil > iso ? blockedUntil : iso
  }

  const [
    openLoans,
    closedLoan,
    lastBuy,
    openRepairs,
    openLayaways,
    creditRow,
    consignorRows,
  ] = await Promise.all([
      supabase
        .from('loans')
        .select('id')
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .in('status', ['active', 'extended', 'partial_paid'])
        .limit(1),
      supabase
        .from('loans')
        .select('updated_at')
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .in('status', ['redeemed', 'forfeited'])
        .order('updated_at', { ascending: false })
        .limit(1),
      supabase
        .from('compliance_log')
        .select('occurred_at')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'buy_outright')
        .eq('customer_snapshot->>id', customerId)
        .order('occurred_at', { ascending: false })
        .limit(1),
      supabase
        .from('repair_tickets')
        .select('id')
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .not('status', 'in', '("picked_up","abandoned","voided")')
        .limit(1),
      supabase
        .from('layaways')
        .select('id')
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .eq('status', 'active')
        .limit(1),
      supabase
        .from('customers')
        .select('store_credit_balance')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase
        .from('consignors')
        .select('id')
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
    ])

  if ((openLoans.data ?? []).length > 0) reasons.push('active_loan')

  if (years != null) {
    const closedAt = closedLoan.data?.[0]?.updated_at
    if (closedAt) {
      const until = addYearsIso(closedAt, years)
      if (until > today) {
        reasons.push('pawn_retention_window')
        extend(until)
      }
    }
    const boughtAt = lastBuy.data?.[0]?.occurred_at
    if (boughtAt) {
      const until = addYearsIso(boughtAt, years)
      if (until > today) {
        reasons.push('buy_retention_window')
        extend(until)
      }
    }
  }

  if ((openRepairs.data ?? []).length > 0) reasons.push('active_repair')
  if ((openLayaways.data ?? []).length > 0) reasons.push('active_layaway')

  // Unspent store credit is money the shop holds for this person. Deleting
  // the record would make the liability disappear, so the balance has to be
  // spent or written off first.
  if (Number(creditRow.data?.store_credit_balance ?? 0) > 0) {
    reasons.push('unspent_store_credit')
  }

  // Same for consignment: goods on the floor or an unsettled balance both
  // mean an open account with this person.
  const consignorIds = (consignorRows.data ?? []).map((c) => c.id)
  if (consignorIds.length > 0) {
    const [{ data: floorItems }, { data: openPayables }] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('consignor_id', consignorIds)
        .in('status', ['available', 'held'])
        .is('deleted_at', null)
        .limit(1),
      supabase
        .from('consignment_payables')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('consignor_id', consignorIds)
        .eq('status', 'open')
        .limit(1),
    ])
    if ((floorItems ?? []).length > 0 || (openPayables ?? []).length > 0) {
      reasons.push('open_consignment')
    }
  }

  if (reasons.length === 0) return { canDelete: true }
  return { canDelete: false, reasons, blockedUntil }
}
