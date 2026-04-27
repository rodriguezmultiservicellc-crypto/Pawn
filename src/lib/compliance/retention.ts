/**
 * Customer-record retention rules per CLAUDE.md Rule 13.
 *
 * Customer ID scans + customer rows persist as long as:
 *   - any active loan (status not in {'redeemed','forfeited','voided'}), OR
 *   - the per-jurisdiction retention window after the most recent
 *     redemption / forfeiture has not yet expired, OR
 *   - any active layaway, OR
 *   - any in-flight repair ticket, OR
 *   - any sale where the buy-outright hold period has not yet expired
 *     (we treat sales.completed_at + tenant.buy_hold_period_days as the
 *     compliance hold marker for the customer record's perspective —
 *     individual inventory holds are tracked on inventory_items.hold_until).
 *
 * The DELETE button on a customer record is gated on this. The function
 * returns a structured result so the caller can show a friendly reason.
 *
 * v1 ships FL only. Add new states to RETENTION_RULES + update the
 * resolveRetentionDays() lookup.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { PoliceReportFormat } from '@/types/database-aliases'

/** Per-jurisdiction retention windows in DAYS after a transaction terminates. */
export const RETENTION_RULES: Record<
  PoliceReportFormat,
  {
    /** Pawn loans (post-redemption / post-forfeiture). FL = 2 years. */
    pawnAfterClose: number
    /** Buy-outright hold period (the inventory.hold_until window). FL = 30
     *  days for jewelry; configurable per-tenant in `settings`. The number
     *  here is the JURISDICTION FALLBACK when a tenant hasn't overridden. */
    buyHoldPeriod: number
  }
> = {
  fl_leadsonline: {
    pawnAfterClose: 365 * 2, // FL = 2 years post-redemption / forfeiture
    buyHoldPeriod: 30, // FL jewelry hold period
  },
}

export function resolveRetentionDays(
  format: PoliceReportFormat,
): { pawnAfterClose: number; buyHoldPeriod: number } {
  return RETENTION_RULES[format] ?? RETENTION_RULES.fl_leadsonline
}

export type DeleteBlockReason =
  | 'active_loan'
  | 'pawn_retention_window'
  | 'active_repair'
  | 'active_layaway'
  | 'buy_hold_period'

export type CanDeleteCustomerResult =
  | { canDelete: true }
  | {
      canDelete: false
      reasons: ReadonlyArray<DeleteBlockReason>
      /** ISO date when the EARLIEST blocking window expires. Null when one
       *  of the reasons is open-ended (e.g. an active loan). */
      earliestExpiresAt: string | null
    }

/**
 * Determine whether a customer record may be hard-deleted today.
 *
 * Pure read against tenant-scoped tables; uses the user-scoped client (RLS
 * applies). The caller is expected to have already gated by tenant role.
 */
export async function canDeleteCustomer(args: {
  supabase: SupabaseClient<Database>
  customerId: string
  tenantId: string
  format: PoliceReportFormat
}): Promise<CanDeleteCustomerResult> {
  const { supabase, customerId, tenantId, format } = args
  const rules = resolveRetentionDays(format)
  const now = new Date()
  const reasons: DeleteBlockReason[] = []
  let earliest = null as string | null
  const setEarliest = (iso: string) => {
    earliest = earliest != null && earliest < iso ? earliest : iso
  }

  // ── 1. Active loans (no terminal status).
  {
    const { data: openLoans } = await supabase
      .from('loans')
      .select('id, status, due_date')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('status', ['active', 'extended', 'partial_paid'])
      .limit(1)
    if (openLoans && openLoans.length > 0) {
      reasons.push('active_loan')
    }
  }

  // ── 2. Pawn retention window — most recent terminal-state loan.
  {
    const { data: closedLoans } = await supabase
      .from('loans')
      .select('id, status, updated_at')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('status', ['redeemed', 'forfeited'])
      .order('updated_at', { ascending: false })
      .limit(1)
    if (closedLoans && closedLoans.length > 0) {
      const closedAt = new Date(closedLoans[0].updated_at)
      const expires = new Date(closedAt)
      expires.setUTCDate(expires.getUTCDate() + rules.pawnAfterClose)
      if (expires.getTime() > now.getTime()) {
        reasons.push('pawn_retention_window')
        const iso = expires.toISOString().slice(0, 10)
        setEarliest(iso)
      }
    }
  }

  // ── 3. Active repair tickets.
  {
    const { data: openRepairs } = await supabase
      .from('repair_tickets')
      .select('id, status')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .not('status', 'in', '("picked_up","abandoned","voided")')
      .limit(1)
    if (openRepairs && openRepairs.length > 0) {
      reasons.push('active_repair')
    }
  }

  // ── 4. Active layaways.
  {
    const { data: openLayaways } = await supabase
      .from('layaways')
      .select('id, status')
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .limit(1)
    if (openLayaways && openLayaways.length > 0) {
      reasons.push('active_layaway')
    }
  }

  // ── 5. Buy-hold inventory referencing this customer (via the most
  //   recent compliance_log row of buy_outright type — items are not
  //   directly customer-FK'd in inventory).
  {
    const { data: holds } = await supabase
      .from('compliance_log')
      .select('id, occurred_at')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'buy_outright')
      .order('occurred_at', { ascending: false })
      .limit(50)
    if (holds && holds.length > 0) {
      // We can't filter by customer_id at query time (it's a JSONB snapshot
      // field). Fetch the recent batch and filter in-memory.
      const recent = holds.find((h) => {
        const occurred = new Date(h.occurred_at)
        const expires = new Date(occurred)
        expires.setUTCDate(expires.getUTCDate() + rules.buyHoldPeriod)
        return expires.getTime() > now.getTime()
      })
      if (recent) {
        // Verify that the snapshot points at this customer by re-reading
        // the row's JSONB. Cheap — we already have the id.
        const { data: detail } = await supabase
          .from('compliance_log')
          .select('id, customer_snapshot, occurred_at')
          .eq('id', recent.id)
          .maybeSingle()
        const customerIdInSnapshot =
          detail?.customer_snapshot &&
          typeof detail.customer_snapshot === 'object' &&
          !Array.isArray(detail.customer_snapshot)
            ? (detail.customer_snapshot as Record<string, unknown>).customer_id
            : null
        if (customerIdInSnapshot === customerId) {
          reasons.push('buy_hold_period')
          const occurred = new Date(detail!.occurred_at)
          const expires = new Date(occurred)
          expires.setUTCDate(expires.getUTCDate() + rules.buyHoldPeriod)
          const iso = expires.toISOString().slice(0, 10)
          setEarliest(iso)
        }
      }
    }
  }

  if (reasons.length === 0) return { canDelete: true }
  return { canDelete: false, reasons, earliestExpiresAt: earliest }
}
