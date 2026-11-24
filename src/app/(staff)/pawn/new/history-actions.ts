'use server'

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { loadTenantRules } from '@/lib/jurisdictions/load'
import { todayInTimezone } from '@/lib/jurisdictions/rules'
import {
  buildCustomerPawnHistory,
  outcomeOf,
  type CustomerPawnHistory,
  type HistoryItemInput,
  type HistoryLoanInput,
} from '@/lib/pawn/customer-history'

/** Tickets whose pieces are read: the recent list and the "pawned before" chips come from these. */
const ITEM_LOANS = 80

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The pawn history of the customer picked on the new-ticket screen: counts
 * (picked up / lost / open), recent tickets, and the pieces they picked up
 * before. Read-only. Staff of the active shop only; every query is scoped to
 * that shop on top of RLS — a customer id from another shop finds nothing.
 */
export async function loadCustomerPawnHistoryAction(
  customerId: string,
): Promise<{ ok: true; history: CustomerPawnHistory } | { ok: false }> {
  if (!UUID.test(customerId)) return { ok: false }
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { ok: false }
  const tenantId = ctx.tenantId
  const { supabase } = await requireRoleInTenant(tenantId, ['owner', 'manager', 'pawn_clerk', 'chain_admin', 'appraiser'])

  // Counts need every ticket. 1,000 is the API's answer size; no customer is
  // near it (the busiest has a few hundred), and counts past it would only
  // be low, never wrong about a piece.
  const [{ data: loanRows, error: loanErr }, rules] = await Promise.all([
    supabase
      .from('loans')
      .select('id, ticket_number, status, principal, issue_date, due_date')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('issue_date', { ascending: false })
      .order('id', { ascending: true })
      .limit(1000),
    // "Overdue" is judged on the shop's day, not UTC's.
    loadTenantRules(supabase, tenantId),
  ])
  if (loanErr) return { ok: false }
  const loans = (loanRows ?? []) as HistoryLoanInput[]

  let items: HistoryItemInput[] = []
  // The newest tickets, plus every open one however old: a piece on an open
  // ticket is in the safe, and the "pawned before" chips must know it.
  const ids = loans
    .filter((l, i) => i < ITEM_LOANS || outcomeOf(l.status) === 'open')
    .map((l) => l.id)
  if (ids.length > 0) {
    const { data: itemRows, error: itemErr } = await supabase
      .from('loan_collateral_items')
      .select(
        `loan_id, position, description, category, metal_type, karat, weight_grams, est_value,
         jewelry_size, color, gemstone_description, unique_marks, pawn_category_slug, pawn_subcategory_slug,
         firearm_make, firearm_model, firearm_caliber, firearm_serial_number, firearm_type,
         electronic_brand, electronic_model, electronic_serial, tool_brand, tool_model`,
      )
      .eq('tenant_id', tenantId)
      .in('loan_id', ids)
      .is('deleted_at', null)
      .limit(1000)
    if (itemErr) return { ok: false }
    items = (itemRows ?? []) as HistoryItemInput[]
  }

  return {
    ok: true,
    history: buildCustomerPawnHistory({ loans, items, today: todayInTimezone(rules.timezone) }),
  }
}
