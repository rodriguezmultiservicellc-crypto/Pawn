/**
 * Cross-shop rollup — high-level KPIs grouped by child tenant.
 *
 * Only rendered for chain_hq tenants. Reads my_chain_tenant_ids() (via the
 * RLS helper) to enumerate the children, then aggregates loans, sales,
 * repair counts, and inventory turn metrics per child.
 *
 * The page that calls this resolves the children via a tenants query
 * (where parent_tenant_id = hq.id) and passes them in as tenantIds.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export type CrossShopRow = {
  tenant_id: string
  tenant_name: string
  active_loans: number
  loans_principal_outstanding: number
  redemptions_in_range: number
  forfeitures_in_range: number
  interest_income_in_range: number
  sales_count_in_range: number
  sales_total_in_range: number
  repair_tickets_in_range: number
  inventory_units_sold_in_range: number
  inventory_revenue_in_range: number
}

export async function getCrossShopRollup(args: {
  supabase: SupabaseClient<Database>
  hqTenantId: string
  range: ReportRange
}): Promise<ReportResult<CrossShopRow>> {
  const { supabase, hqTenantId, range } = args
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`

  // 1. Resolve children of this HQ.
  const { data: children, error: childErr } = await supabase
    .from('tenants')
    .select('id, name, dba')
    .eq('parent_tenant_id', hqTenantId)
    .eq('is_active', true)
    .order('name')
  if (childErr) throw new Error(`cross_shop_children_failed: ${childErr.message}`)
  const childTenants = children ?? []
  const childIds = childTenants.map((c) => c.id)

  if (childIds.length === 0) {
    return { rows: [], totals: {}, tenantIds: [] }
  }

  // 2. Aggregate in parallel — one query per metric across all children,
  //    then bucket by tenant_id client-side.
  const [
    activeLoans,
    closedLoanEvents,
    sales,
    repairs,
    soldInventory,
  ] = await Promise.all([
    supabase
      .from('loans')
      .select('tenant_id, principal, status')
      .in('tenant_id', childIds)
      .is('deleted_at', null)
      .in('status', ['active', 'extended', 'partial_paid']),
    supabase
      .from('loan_events')
      .select('tenant_id, event_type, interest_paid, amount, occurred_at')
      .in('tenant_id', childIds)
      .in('event_type', ['payment', 'redemption', 'forfeiture'])
      .gte('occurred_at', fromIso)
      .lt('occurred_at', toExclusiveIso),
    supabase
      .from('sales')
      .select('tenant_id, total, returned_total, status, completed_at')
      .in('tenant_id', childIds)
      .is('deleted_at', null)
      .in('status', ['completed', 'partial_returned', 'fully_returned'])
      .gte('completed_at', fromIso)
      .lt('completed_at', toExclusiveIso),
    supabase
      .from('repair_tickets')
      .select('tenant_id, created_at')
      .in('tenant_id', childIds)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso),
    supabase
      .from('inventory_items')
      .select('tenant_id, sale_price, sold_at, status')
      .in('tenant_id', childIds)
      .is('deleted_at', null)
      .eq('status', 'sold')
      .gte('sold_at', fromIso)
      .lt('sold_at', toExclusiveIso),
  ])

  function byTenant<T extends { tenant_id: string }>(
    list: ReadonlyArray<T> | null,
  ): Map<string, T[]> {
    const m = new Map<string, T[]>()
    for (const x of list ?? []) {
      const arr = m.get(x.tenant_id) ?? []
      arr.push(x)
      m.set(x.tenant_id, arr)
    }
    return m
  }

  const activeByTenant = byTenant(
    (activeLoans.data ?? []) as Array<{ tenant_id: string; principal: number | string; status: string }>,
  )
  const eventsByTenant = byTenant(
    (closedLoanEvents.data ?? []) as Array<{
      tenant_id: string
      event_type: string
      interest_paid: number | string
      amount: number | string | null
    }>,
  )
  const salesByTenant = byTenant(
    (sales.data ?? []) as Array<{
      tenant_id: string
      total: number | string
      returned_total: number | string
      status: string
    }>,
  )
  const repairsByTenant = byTenant(
    (repairs.data ?? []) as Array<{ tenant_id: string }>,
  )
  const inventoryByTenant = byTenant(
    (soldInventory.data ?? []) as Array<{
      tenant_id: string
      sale_price: number | string | null
    }>,
  )

  const rows: CrossShopRow[] = childTenants.map((c) => {
    const al = activeByTenant.get(c.id) ?? []
    const ev = eventsByTenant.get(c.id) ?? []
    const sl = salesByTenant.get(c.id) ?? []
    const rt = repairsByTenant.get(c.id) ?? []
    const inv = inventoryByTenant.get(c.id) ?? []

    return {
      tenant_id: c.id,
      tenant_name: c.dba?.trim() || c.name,
      active_loans: al.length,
      loans_principal_outstanding: al.reduce(
        (s, x) => s + Number(x.principal ?? 0),
        0,
      ),
      redemptions_in_range: ev.filter((x) => x.event_type === 'redemption').length,
      forfeitures_in_range: ev.filter((x) => x.event_type === 'forfeiture').length,
      interest_income_in_range: ev.reduce(
        (s, x) => s + Number(x.interest_paid ?? 0),
        0,
      ),
      sales_count_in_range: sl.length,
      sales_total_in_range: sl.reduce(
        (s, x) => s + Number(x.total ?? 0) - Number(x.returned_total ?? 0),
        0,
      ),
      repair_tickets_in_range: rt.length,
      inventory_units_sold_in_range: inv.length,
      inventory_revenue_in_range: inv.reduce(
        (s, x) => s + Number(x.sale_price ?? 0),
        0,
      ),
    }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.active_loans += r.active_loans
      acc.loans_principal_outstanding += r.loans_principal_outstanding
      acc.redemptions += r.redemptions_in_range
      acc.forfeitures += r.forfeitures_in_range
      acc.interest_income += r.interest_income_in_range
      acc.sales_count += r.sales_count_in_range
      acc.sales_total += r.sales_total_in_range
      acc.repair_tickets += r.repair_tickets_in_range
      acc.inventory_units += r.inventory_units_sold_in_range
      acc.inventory_revenue += r.inventory_revenue_in_range
      return acc
    },
    {
      active_loans: 0,
      loans_principal_outstanding: 0,
      redemptions: 0,
      forfeitures: 0,
      interest_income: 0,
      sales_count: 0,
      sales_total: 0,
      repair_tickets: 0,
      inventory_units: 0,
      inventory_revenue: 0,
    } as Record<string, number>,
  )

  return { rows, totals, tenantIds: childIds }
}
