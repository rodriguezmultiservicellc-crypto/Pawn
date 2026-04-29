import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import DashboardContent, {
  type ActivityFeedItem,
  type RecentCustomer,
  type RecentItem,
} from './content'
import { addDaysIso, todayDateString } from '@/lib/pawn/math'

type CustomerNameRel = {
  first_name: string
  last_name: string
} | null

function customerLabel(c: CustomerNameRel): string {
  if (!c) return '—'
  return `${c.last_name}, ${c.first_name}`
}

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
  // Tickets transitioned to a "done" state per day in the trailing window.
  // We treat any ticket with completed_at set as a finished ticket — that
  // covers both the markComplete path (ready) and the QA approve path
  // (which also stamps completed_at). Index from oldest → newest.
  const repairsCompleted14d: number[] = Array<number>(DAILY_REVENUE_DAYS).fill(0)
  if (hasRepair) {
    const [{ count: a }, { count: r }, { count: rt }, { data: completedRows }] =
      await Promise.all([
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
        ctx.supabase
          .from('repair_tickets')
          .select('completed_at')
          .eq('tenant_id', ctx.tenantId)
          .is('deleted_at', null)
          .not('completed_at', 'is', null)
          .gte('completed_at', dailyRevenueWindowStartIso),
      ])
    activeRepairCount = a ?? 0
    readyForPickupCount = r ?? 0
    repairsTodayCount = rt ?? 0
    const cBuckets = new Map<string, number>()
    for (const row of completedRows ?? []) {
      const stamp = row.completed_at as string | null
      if (!stamp) continue
      const day = stamp.slice(0, 10)
      cBuckets.set(day, (cBuckets.get(day) ?? 0) + 1)
    }
    for (let i = 0; i < DAILY_REVENUE_DAYS; i += 1) {
      const day = addDaysIso(dailyRevenueWindowStart, i)
      repairsCompleted14d[i] = cBuckets.get(day) ?? 0
    }
  }

  let todaySalesCount = 0
  let todayRevenue = 0
  let activeLayawayCount = 0
  // Daily-revenue series for the last DAILY_REVENUE_DAYS days, oldest →
  // newest, indexed by day-offset from `dailyRevenueWindowStart`. Filled
  // in below from the same query that drives `todayRevenue` (we already
  // have to read the rows anyway, so we fold the rollup into one pass).
  const dailyRevenue14d: number[] = Array<number>(DAILY_REVENUE_DAYS).fill(0)
  // Layaway-payments collected per day in the trailing window. Refunds
  // are written as NEGATIVE rows on layaway_payments; we exclude them
  // here so the chart shows gross collections and the empty/refund-only
  // case doesn't dip below zero.
  const layawayPayments14d: number[] = Array<number>(DAILY_REVENUE_DAYS).fill(0)
  if (hasRetail) {
    const [
      { count: a },
      { data: windowRows },
      { count: lc },
      { data: layawayRows },
    ] = await Promise.all([
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
      ctx.supabase
        .from('layaway_payments')
        .select('amount, created_at')
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .gt('amount', 0)
        .gte('created_at', dailyRevenueWindowStartIso),
    ])
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
    const layawayBuckets = new Map<string, number>()
    for (const r of layawayRows ?? []) {
      const stamp = r.created_at as string | null
      if (!stamp) continue
      const day = stamp.slice(0, 10)
      layawayBuckets.set(
        day,
        (layawayBuckets.get(day) ?? 0) + Number(r.amount ?? 0),
      )
    }
    for (let i = 0; i < DAILY_REVENUE_DAYS; i += 1) {
      const day = addDaysIso(dailyRevenueWindowStart, i)
      // Round to cents to avoid float drift before passing through the
      // chart.
      dailyRevenue14d[i] = Math.round((buckets.get(day) ?? 0) * 100) / 100
      layawayPayments14d[i] =
        Math.round((layawayBuckets.get(day) ?? 0) * 100) / 100
    }
    todayRevenue = dailyRevenue14d[DAILY_REVENUE_DAYS - 1] ?? 0
  }

  let activeLoanCount = 0
  let dueThisWeekCount = 0
  let pawnTodayCount = 0
  // New pawn loans created per day in the trailing window. Each loan
  // contributes 1 to its created_at day's bucket regardless of dollar
  // amount — the chart pairs against `redemptions14d` so volume is the
  // meaningful comparison, not principal.
  const pawnsCreated14d: number[] = Array<number>(DAILY_REVENUE_DAYS).fill(0)
  // Redemptions per day. Source = loan_events.event_type='redemption'
  // because `loans.status` flipping doesn't preserve the date the
  // payoff actually happened (status edits stamp updated_at, but a
  // later edit would overwrite it). loan_events is append-only and
  // carries `occurred_at` for exactly this purpose.
  const redemptions14d: number[] = Array<number>(DAILY_REVENUE_DAYS).fill(0)
  if (hasPawn) {
    const [
      { count: a },
      { count: d },
      { count: p },
      { data: pawnRows },
      { data: redeemRows },
    ] = await Promise.all([
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
      ctx.supabase
        .from('loans')
        .select('created_at')
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .gte('created_at', dailyRevenueWindowStartIso),
      ctx.supabase
        .from('loan_events')
        .select('occurred_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('event_type', 'redemption')
        .gte('occurred_at', dailyRevenueWindowStartIso),
    ])
    activeLoanCount = a ?? 0
    dueThisWeekCount = d ?? 0
    pawnTodayCount = p ?? 0
    const pBuckets = new Map<string, number>()
    for (const row of pawnRows ?? []) {
      const stamp = row.created_at as string | null
      if (!stamp) continue
      const day = stamp.slice(0, 10)
      pBuckets.set(day, (pBuckets.get(day) ?? 0) + 1)
    }
    const rBuckets = new Map<string, number>()
    for (const row of redeemRows ?? []) {
      const stamp = row.occurred_at as string | null
      if (!stamp) continue
      const day = stamp.slice(0, 10)
      rBuckets.set(day, (rBuckets.get(day) ?? 0) + 1)
    }
    for (let i = 0; i < DAILY_REVENUE_DAYS; i += 1) {
      const day = addDaysIso(dailyRevenueWindowStart, i)
      pawnsCreated14d[i] = pBuckets.get(day) ?? 0
      redemptions14d[i] = rBuckets.get(day) ?? 0
    }
  }

  // ── Unified activity feed ────────────────────────────────────────────
  // Pulls the most recent ~6 rows from each enabled module table, merges
  // them, and surfaces the top entries in the Overview "Recent activity"
  // panel. We query module tables directly (instead of audit_log) because
  // we need the actual record fields for display — joining audit_log to
  // every source table at render time is expensive and the customer-name
  // path is what the operator actually wants to see.
  const FEED_PER_TABLE = 6
  const FEED_TOTAL = 10
  // PromiseLike (not Promise) because Supabase's .then returns a thenable —
  // Promise.all accepts thenables fine, but the explicit narrower type
  // would reject them.
  const activityQueries: PromiseLike<{ items: ActivityFeedItem[] }>[] = []

  // Customers + inventory always run — those modules are always on.
  activityQueries.push(
    ctx.supabase
      .from('customers')
      .select('id, first_name, last_name, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(FEED_PER_TABLE)
      .then(({ data }) => ({
        items: (data ?? []).map(
          (r): ActivityFeedItem => ({
            id: `cust-${r.id}`,
            kind: 'customer',
            title: `${r.last_name}, ${r.first_name}`,
            subtitle: '',
            amount: null,
            href: `/customers/${r.id}`,
            created_at: r.created_at,
          }),
        ),
      })),
  )
  activityQueries.push(
    ctx.supabase
      .from('inventory_items')
      .select('id, sku, description, list_price, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(FEED_PER_TABLE)
      .then(({ data }) => ({
        items: (data ?? []).map(
          (r): ActivityFeedItem => ({
            id: `inv-${r.id}`,
            kind: 'inventory',
            title: r.description ?? r.sku ?? '—',
            subtitle: r.sku ?? '',
            amount: r.list_price == null ? null : Number(r.list_price),
            href: `/inventory/${r.id}`,
            created_at: r.created_at,
          }),
        ),
      })),
  )

  if (hasPawn) {
    activityQueries.push(
      ctx.supabase
        .from('loans')
        .select(
          `id, ticket_number, principal, created_at,
           customer:customers(first_name, last_name)`,
        )
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(FEED_PER_TABLE)
        .then(({ data }) => ({
          items: (data ?? []).map((r) => {
            const c = (r as unknown as { customer: CustomerNameRel })
              .customer
            return {
              id: `loan-${r.id}`,
              kind: 'pawn' as const,
              title: customerLabel(c),
              subtitle: r.ticket_number ?? '',
              amount: r.principal == null ? null : Number(r.principal),
              href: `/pawn/${r.id}`,
              created_at: r.created_at,
            } satisfies ActivityFeedItem
          }),
        })),
    )
  }

  if (hasRetail) {
    activityQueries.push(
      ctx.supabase
        .from('sales')
        .select(
          `id, sale_number, total, created_at,
           customer:customers(first_name, last_name)`,
        )
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(FEED_PER_TABLE)
        .then(({ data }) => ({
          items: (data ?? []).map((r) => {
            const c = (r as unknown as { customer: CustomerNameRel })
              .customer
            return {
              id: `sale-${r.id}`,
              kind: 'sale' as const,
              title: customerLabel(c),
              subtitle: r.sale_number ?? '',
              amount: r.total == null ? null : Number(r.total),
              href: `/pos/sales/${r.id}`,
              created_at: r.created_at,
            } satisfies ActivityFeedItem
          }),
        })),
    )
    activityQueries.push(
      ctx.supabase
        .from('layaways')
        .select(
          `id, layaway_number, total_due, created_at,
           customer:customers(first_name, last_name)`,
        )
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(FEED_PER_TABLE)
        .then(({ data }) => ({
          items: (data ?? []).map((r) => {
            const c = (r as unknown as { customer: CustomerNameRel })
              .customer
            return {
              id: `lay-${r.id}`,
              kind: 'layaway' as const,
              title: customerLabel(c),
              subtitle: r.layaway_number ?? '',
              amount: r.total_due == null ? null : Number(r.total_due),
              href: `/pos/layaways/${r.id}`,
              created_at: r.created_at,
            } satisfies ActivityFeedItem
          }),
        })),
    )
  }

  if (hasRepair) {
    activityQueries.push(
      ctx.supabase
        .from('repair_tickets')
        .select(
          `id, ticket_number, title, quote_amount, created_at,
           customer:customers(first_name, last_name)`,
        )
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(FEED_PER_TABLE)
        .then(({ data }) => ({
          items: (data ?? []).map((r) => {
            const c = (r as unknown as { customer: CustomerNameRel })
              .customer
            return {
              id: `rep-${r.id}`,
              kind: 'repair' as const,
              title: r.title ?? customerLabel(c),
              subtitle: `${r.ticket_number ?? ''} · ${customerLabel(c)}`,
              amount:
                r.quote_amount == null ? null : Number(r.quote_amount),
              href: `/repair/${r.id}`,
              created_at: r.created_at,
            } satisfies ActivityFeedItem
          }),
        })),
    )
  }

  const feedResults = await Promise.all(activityQueries)
  const recentActivity: ActivityFeedItem[] = feedResults
    .flatMap((r) => r.items)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, FEED_TOTAL)

  return (
    <DashboardContent
      customerCount={customerCount ?? 0}
      bannedCount={bannedCount ?? 0}
      inventoryCount={inventoryCount ?? 0}
      heldCount={heldCount ?? 0}
      recentCustomers={(recentCustomers ?? []) as RecentCustomer[]}
      recentItems={(recentItems ?? []) as RecentItem[]}
      recentActivity={recentActivity}
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
      pawnsCreated14d={pawnsCreated14d}
      redemptions14d={redemptions14d}
      layawayPayments14d={layawayPayments14d}
      repairsCompleted14d={repairsCompleted14d}
    />
  )
}
