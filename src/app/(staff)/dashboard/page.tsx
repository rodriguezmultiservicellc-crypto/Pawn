import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import DashboardContent, { type RecentCustomer, type RecentItem } from './content'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'

export default async function DashboardPage() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate for pawn / repair / retail cards.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_repair, has_retail')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  const hasPawn = tenant?.has_pawn ?? false
  const hasRepair = tenant?.has_repair ?? false
  const hasRetail = tenant?.has_retail ?? false
  const today = todayDateString()
  const in7 = addDaysIso(today, 7)
  const todayStartIso = `${today}T00:00:00.000Z`

  // Counts via head=true + count='exact' so no rows are returned, just totals.
  // RLS already gates each query to the tenant.
  const [
    { count: customerCount },
    { count: bannedCount },
    { count: inventoryCount },
    { count: heldCount },
    { data: recentCustomers },
    { data: recentItems },
  ] = await Promise.all([
    ctx.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null),
    ctx.supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('is_banned', true),
    ctx.supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'available'),
    ctx.supabase
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'held'),
    ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, phone, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, status, list_price, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  let activeRepairCount = 0
  let readyForPickupCount = 0
  if (hasRepair) {
    const [{ count: a }, { count: r }] = await Promise.all([
      ctx.supabase
        .from('repair_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .in('status', ['in_progress', 'needs_parts']),
      ctx.supabase
        .from('repair_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .eq('status', 'ready'),
    ])
    activeRepairCount = a ?? 0
    readyForPickupCount = r ?? 0
  }

  let todaySalesCount = 0
  let todayRevenue = 0
  let activeLayawayCount = 0
  if (hasRetail) {
    const [{ count: a }, { data: revRows }, { count: lc }] = await Promise.all([
      ctx.supabase
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .eq('status', 'completed')
        .gte('completed_at', todayStartIso),
      ctx.supabase
        .from('sales')
        .select('total')
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .eq('status', 'completed')
        .gte('completed_at', todayStartIso),
      ctx.supabase
        .from('layaways')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .eq('status', 'active'),
    ])
    todaySalesCount = a ?? 0
    todayRevenue = (revRows ?? []).reduce(
      (sum, r) => sum + Number(r.total ?? 0),
      0,
    )
    activeLayawayCount = lc ?? 0
  }

  let activeLoanCount = 0
  let dueThisWeekCount = 0
  if (hasPawn) {
    const [{ count: a }, { count: d }] = await Promise.all([
      ctx.supabase
        .from('loans')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .in('status', ['active', 'extended', 'partial_paid']),
      ctx.supabase
        .from('loans')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .in('status', ['active', 'extended', 'partial_paid'])
        .gte('due_date', today)
        .lte('due_date', in7),
    ])
    activeLoanCount = a ?? 0
    dueThisWeekCount = d ?? 0
  }

  return (
    <DashboardContent
      customerCount={customerCount ?? 0}
      bannedCount={bannedCount ?? 0}
      inventoryCount={inventoryCount ?? 0}
      heldCount={heldCount ?? 0}
      recentCustomers={(recentCustomers ?? []) as RecentCustomer[]}
      recentItems={(recentItems ?? []) as RecentItem[]}
      hasPawn={hasPawn}
      activeLoanCount={activeLoanCount}
      dueThisWeekCount={dueThisWeekCount}
      hasRepair={hasRepair}
      activeRepairCount={activeRepairCount}
      readyForPickupCount={readyForPickupCount}
      hasRetail={hasRetail}
      todaySalesCount={todaySalesCount}
      todayRevenue={todayRevenue}
      activeLayawayCount={activeLayawayCount}
    />
  )
}
