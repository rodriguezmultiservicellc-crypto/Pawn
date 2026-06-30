import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import DashboardContent, {
  type DueSoonRow,
  type ActivityRow,
} from './content'
import { todayDateString, daysBetween, payoffBalance } from '@/lib/pawn/math'

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
  const todayStartIso = `${today}T00:00:00.000Z`

  const NON_TERMINAL = ['active', 'extended', 'partial_paid'] as const

  // Library counts (always). RLS gates each query to the tenant.
  const [
    { count: customerCount },
    { count: bannedCount },
    { count: inventoryCount },
    { count: heldCount },
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
  ])

  // ── Repair (gated) ─────────────────────────────────────────────────────────
  let readyForPickupCount = 0
  let repairsNeedPartsCount = 0
  if (hasRepair) {
    const [{ count: r }, { count: np }] = await Promise.all([
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
        .eq('status', 'needs_parts'),
    ])
    readyForPickupCount = r ?? 0
    repairsNeedPartsCount = np ?? 0
  }

  // ── Retail (gated): today's money + recent sales for the activity feed ─────
  let todaySalesCount = 0
  let todayRevenue = 0
  type SaleFeedRow = {
    id: string
    sale_number: string | null
    total: number | string | null
    completed_at: string | null
  }
  let recentSales: SaleFeedRow[] = []
  if (hasRetail) {
    const [{ count: a }, { data: revRows }, { data: rs }] = await Promise.all([
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
        .from('sales')
        .select('id, sale_number, total, completed_at')
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(8),
    ])
    todaySalesCount = a ?? 0
    todayRevenue = (revRows ?? []).reduce(
      (sum, r) => sum + Number(r.total ?? 0),
      0,
    )
    recentSales = (rs ?? []) as unknown as SaleFeedRow[]
  }

  // ── Pawn (gated): book-driven money KPIs + due-soon list + recent events ───
  let activeLoanCount = 0
  let dueThisWeekCount = 0
  let overdueLoanCount = 0
  let onLoanNow = 0
  let interestDue7 = 0
  let overdueAtRisk = 0
  let loansDueSoon: DueSoonRow[] = []
  type LoanEventFeedRow = {
    id: string
    event_type: string
    amount: number | string | null
    occurred_at: string
    loan: {
      id: string
      ticket_number: string | null
      customer: { first_name: string; last_name: string } | null
    } | null
  }
  let recentLoanEvents: LoanEventFeedRow[] = []

  if (hasPawn) {
    type BookLoan = {
      id: string
      ticket_number: string | null
      principal: number | string
      interest_rate_monthly: number | string
      issue_date: string
      due_date: string
      min_monthly_charge: number | string | null
      customer: { first_name: string; last_name: string } | null
    }
    const [{ data: bookData }, { data: evFeed }] = await Promise.all([
      ctx.supabase
        .from('loans')
        .select(
          `id, ticket_number, principal, interest_rate_monthly, issue_date,
           due_date, min_monthly_charge,
           customer:customers(first_name, last_name)`,
        )
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .in('status', NON_TERMINAL)
        .limit(1000),
      ctx.supabase
        .from('loan_events')
        .select(
          `id, event_type, amount, occurred_at,
           loan:loans(id, ticket_number, customer:customers(first_name, last_name))`,
        )
        .eq('tenant_id', ctx.tenantId)
        .order('occurred_at', { ascending: false })
        .limit(8),
    ])
    const book = (bookData ?? []) as unknown as BookLoan[]
    recentLoanEvents = (evFeed ?? []) as unknown as LoanEventFeedRow[]
    activeLoanCount = book.length

    // Batched events for payoff math across the whole active book.
    const bookIds = book.map((l) => l.id)
    type EventLite = {
      principal_paid: number
      interest_paid: number
      fees_paid: number
    }
    const eventsByLoan = new Map<string, EventLite[]>()
    if (bookIds.length) {
      const { data: evRows } = await ctx.supabase
        .from('loan_events')
        .select('loan_id, principal_paid, interest_paid, fees_paid')
        .in('loan_id', bookIds)
      for (const e of (evRows ?? []) as unknown as {
        loan_id: string
        principal_paid: number | string | null
        interest_paid: number | string | null
        fees_paid: number | string | null
      }[]) {
        const lite: EventLite = {
          principal_paid: Number(e.principal_paid ?? 0),
          interest_paid: Number(e.interest_paid ?? 0),
          fees_paid: Number(e.fees_paid ?? 0),
        }
        const arr = eventsByLoan.get(e.loan_id)
        if (arr) arr.push(lite)
        else eventsByLoan.set(e.loan_id, [lite])
      }
    }

    const withPayoff = book.map((l) => {
      const po = payoffBalance({
        principal:
          typeof l.principal === 'string' ? parseFloat(l.principal) : l.principal,
        monthlyRate:
          typeof l.interest_rate_monthly === 'string'
            ? parseFloat(l.interest_rate_monthly)
            : l.interest_rate_monthly,
        issueDate: l.issue_date,
        today,
        events: eventsByLoan.get(l.id) ?? [],
        minMonthlyCharge:
          l.min_monthly_charge == null
            ? null
            : typeof l.min_monthly_charge === 'string'
            ? parseFloat(l.min_monthly_charge)
            : l.min_monthly_charge,
      })
      const d = daysBetween(today, l.due_date)
      return { l, po, d }
    })

    for (const { po, d } of withPayoff) {
      onLoanNow += po.principalOutstanding
      if (d < 0) {
        overdueLoanCount += 1
        overdueAtRisk += po.payoff
      } else if (d <= 7) {
        dueThisWeekCount += 1
        interestDue7 += po.interestOutstanding
      }
    }

    // Due-soon panel: overdue first, then soonest due, top 6.
    loansDueSoon = withPayoff
      .slice()
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map(({ l, po, d }) => ({
        id: l.id,
        ticket_number: l.ticket_number ?? '',
        customer_name: l.customer
          ? `${l.customer.last_name}, ${l.customer.first_name}`
          : '—',
        due_date: l.due_date,
        days: d,
        payoff: po.payoff,
      }))
  }

  // ── Cross-module recent activity feed (sales + loan events) ────────────────
  const activity: ActivityRow[] = [
    ...recentSales.map((s) => ({
      id: `sale-${s.id}`,
      kind: 'sale' as const,
      title: s.sale_number ? `#${s.sale_number}` : 'Sale',
      subtitle: null as string | null,
      amount: s.total == null ? null : Number(s.total),
      occurredAt: s.completed_at ?? '',
      href: `/pos/sales/${s.id}`,
    })),
    ...recentLoanEvents.map((e) => {
      const ticket = e.loan?.ticket_number ?? ''
      const who = e.loan?.customer
        ? `${e.loan.customer.last_name}, ${e.loan.customer.first_name}`
        : null
      const kind: ActivityRow['kind'] =
        e.event_type === 'issued'
          ? 'loan'
          : e.event_type === 'redemption'
          ? 'redeem'
          : 'pay'
      return {
        id: `loanev-${e.id}`,
        kind,
        title: ticket,
        subtitle: who,
        amount: e.amount == null ? null : Number(e.amount),
        occurredAt: e.occurred_at,
        href: e.loan ? `/pawn/${e.loan.id}` : '/pawn',
        eventType: e.event_type,
      }
    }),
  ]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .slice(0, 8)

  return (
    <DashboardContent
      hasPawn={hasPawn}
      hasRepair={hasRepair}
      hasRetail={hasRetail}
      today={today}
      money={{
        todaySalesCount,
        todayRevenue,
        onLoanNow,
        interestDue7,
        dueThisWeekCount,
        overdueAtRisk,
        overdueLoanCount,
      }}
      attention={{
        dueThisWeekCount,
        overdueLoanCount,
        heldCount: heldCount ?? 0,
        readyForPickupCount,
        repairsNeedPartsCount,
      }}
      loansDueSoon={loansDueSoon}
      activity={activity}
      library={{
        customerCount: customerCount ?? 0,
        inventoryCount: inventoryCount ?? 0,
        bannedCount: bannedCount ?? 0,
      }}
      activeLoanCount={activeLoanCount}
    />
  )
}
