'use server'

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  buildCustomerRepairHistory,
  type CustomerRepairHistory,
  type RepairHistoryInput,
} from '@/lib/repair/customer-history'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The repair history of the customer picked on New repair ticket. Read-only.
 * Repair staff of the active shop only; scoped to that shop on top of RLS —
 * a customer id from another shop finds nothing. 1,000 rows is the API's
 * answer size; no customer is near it.
 */
export async function loadCustomerRepairHistoryAction(
  customerId: string,
): Promise<{ ok: true; history: CustomerRepairHistory } | { ok: false }> {
  if (!UUID.test(customerId)) return { ok: false }
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { ok: false }
  const tenantId = ctx.tenantId
  const { supabase } = await requireRoleInTenant(tenantId, [
    'owner',
    'manager',
    'pawn_clerk',
    'repair_tech',
    'chain_admin',
  ])

  const { data, error } = await supabase
    .from('repair_tickets')
    .select('id, ticket_number, status, title, item_description, quote_amount, balance_due, created_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return { ok: false }
  return { ok: true, history: buildCustomerRepairHistory((data ?? []) as RepairHistoryInput[]) }
}
