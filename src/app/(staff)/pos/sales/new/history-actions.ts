'use server'

import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  buildCustomerSalesHistory,
  SALES_HISTORY_RECENT_MAX,
  salesNewestFirst,
  type CustomerSalesHistory,
  type LayawayHistoryInput,
  type SaleHistoryInput,
  type SaleLineInput,
} from '@/lib/pos/customer-history'
import { SALE_STAFF_ROLES } from './sale-core'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The purchases and layaways of the customer picked on New sale. Read-only.
 * Sale staff of the active shop only; scoped to that shop on top of RLS.
 * Lines are read only for the recent sales the card lists.
 */
export async function loadCustomerSalesHistoryAction(
  customerId: string,
): Promise<{ ok: true; history: CustomerSalesHistory } | { ok: false }> {
  if (!UUID.test(customerId)) return { ok: false }
  const ctx = await getCtx()
  if (!ctx?.tenantId) return { ok: false }
  const tenantId = ctx.tenantId
  const { supabase } = await requireRoleInTenant(tenantId, SALE_STAFF_ROLES)

  const [salesRes, layRes] = await Promise.all([
    supabase
      .from('sales')
      .select('id, sale_number, sale_kind, status, total, returned_total, completed_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('layaways')
      .select('id, sale_id, status, balance_remaining')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .limit(1000),
  ])
  if (salesRes.error || layRes.error) return { ok: false }
  const sales = (salesRes.data ?? []) as SaleHistoryInput[]
  const layaways = (layRes.data ?? []) as LayawayHistoryInput[]

  // The card lists the newest few; their lines are all it shows.
  const recentIds = salesNewestFirst(sales)
    .slice(0, SALES_HISTORY_RECENT_MAX)
    .map((s) => s.id)
  let lines: SaleLineInput[] = []
  if (recentIds.length > 0) {
    const { data, error } = await supabase
      .from('sale_items')
      .select('sale_id, position, description')
      .eq('tenant_id', tenantId)
      .in('sale_id', recentIds)
      .is('deleted_at', null)
      .limit(1000)
    if (error) return { ok: false }
    lines = (data ?? []) as SaleLineInput[]
  }

  return { ok: true, history: buildCustomerSalesHistory({ sales, layaways, lines }) }
}
