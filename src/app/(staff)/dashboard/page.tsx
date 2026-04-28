import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import DashboardContent, { type RecentCustomer, type RecentItem } from './content'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'

const DAILY_REVENUE_DAYS = 14

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
  // Inclusive 14-day window ending today: [today-13 .. today]. Lower bound
  // becomes the gte filter for the daily-revenue rollup query.
  const dailyRevenueWindowStart = addDaysIso(today, -(DAILY_REVENUE_DAYS - 1))
  const dailyRevenueWindowStartIso = `${dailyRevenueWindowStart}T00:00:00.000Z`

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
  let repairsTodayCount = 0
  if (hasRepair) {
    const [{ count: a }, { count: r }, { count: rt }] = await Promise.all([
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
      ctx.supabase
        .from('repair_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .gte('created_at', todayStartIso),
    ])
    activeRepairCount = a ?? 0
    readyForPickupCount = r ?? 0
    repairsTodayCount = rt ?? 0
  }

  let todaySalesCount = 0
  let todayRevenue = 0
  let activeLayawayCount = 0
  // Daily-revenue series for the last DAILY_REVENUE_DAYS days, oldest →
  // newest, indexed by day-offset from `dailyRevenueWindowStart`. Filled
  // in below from the same query that drives `todayRevenue` (we already
  // have to read the rows anyway, so we fold the rollup into one pass).
  let dailyRevenue14d: number[] = Array<number>(DAILY_REVENUE_DAYS).fill(0)
  if (hasRetail) {
    const [{ count: a }, { data: windowRows }, { count: lc }] = await Promise.all(
      [
        ctx.supabase
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', ctx.tenantId)
          .is('deleted_at', null)
          .eq('status', 'completed')
          .gte('completed_at', todayStartIso),
        ctx.supabase
          .from('sales')
          .select('total, completed_at')
          .eq('tenant_id', ctx.tenantId)
          .is('deleted_at', null)
          .eq('status', 'completed')
          .gte('completed_at', dailyRevenueWindowStartIso),
        ctx.supabase
          .from('layaways')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', ctx.tenantId)
          .is('deleted_at', null)
          .eq('status', 'active'),
      ],
    )
    todaySalesCount = a ?? 0
    activeLayawayCount = lc ?? 0
    // Group sales by UTC date (YYYY-MM-DD) and project into the 14-slot
    // array. Today rolls up into the last slot; today's revenue is the
    // last bucket.
    const buckets = new Map<string, number>()
    for (const r of windowRows ?? []) {
      const stamp = r.completed_at as string | null
      if (!stamp) continue
      const day = stamp.slice(0, 10) // YYYY-MM-DD (UTC) — completed_at is timestamptz ISO
      buckets.set(day, (buckets.get(day) ?? 0) + Number(r.total ?? 0))
    }
    for (let i = 0; i < DAILY_REVENUE_DAYS; i += 1) {
      const day = addDaysIso(dailyRevenueWindowStart, i)
      // Round to cents to avoid float drift before passing through the
      // chart.
      dailyRevenue14d[i] = Math.round((buckets.get(day) ?? 0) * 100) / 100
    }
    todayRevenue = dailyRevenue14d[DAILY_REVENUE_DAYS - 1] ?? 0
  }

  let activeLoanCount = 0
  let dueThisWeekCount = 0
  let pawnTodayCount = 0
  if (hasPawn) {
    const [{ count: a }, { count: d }, { count: p }] = await Promise.all([
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
      ctx.supabase
        .from('loans')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .gte('created_at', todayStartIso),
    ])
    activeLoanCount = a ?? 0
    dueThisWeekCount = d ?? 0
    pawnTodayCount = p ?? 0
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
      pawnTodayCount={pawnTodayCount}
      hasRepair={hasRepair}
      activeRepairCount={activeRepairCount}
      readyForPickupCount={readyForPickupCount}
      repairsTodayCount={repairsTodayCount}
      hasRetail={hasRetail}
      todaySalesCount={todaySalesCount}
      todayRevenue={todayRevenue}
      activeLayawayCount={activeLayawayCount}
      dailyRevenue14d={dailyRevenue14d}
    />
  )
}
