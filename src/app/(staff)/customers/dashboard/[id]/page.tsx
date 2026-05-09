import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  CUSTOMER_DOCUMENTS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import CustomerAnalyticsDashboard, {
  type ActivityEvent,
  type ForfeitedLoanRow,
  type MonthlyBucket,
} from './content'

type Params = Promise<{ id: string }>

export default async function CustomerDashboardPage(props: { params: Params }) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: customer } = await ctx.supabase
    .from('customers')
    .select(
      'id, tenant_id, first_name, last_name, photo_url, phone, email, language, is_banned, banned_reason, loyalty_points_balance, created_at',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customer) redirect('/customers')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn, has_repair, has_retail')
    .eq('id', customer.tenant_id)
    .maybeSingle()
  const hasPawn = tenant?.has_pawn ?? false
  const hasRepair = tenant?.has_repair ?? false
  const hasRetail = tenant?.has_retail ?? false

  const photoSignedUrl = customer.photo_url
    ? await getSignedUrl({
        bucket: CUSTOMER_DOCUMENTS_BUCKET,
        path: customer.photo_url,
        ttlSeconds: 3600,
      })
    : null

  // Pull every module's rows for this customer in parallel. Aggregations
  // happen below in JS — most customers will have <1k rows total. Heavy-
  // hitters can move to RPCs later.
  const [
    { data: loanRows },
    { data: saleRows },
    { data: repairRows },
    { data: layawayRows },
  ] = await Promise.all([
    hasPawn
      ? ctx.supabase
          .from('loans')
          .select(
            'id, ticket_number, principal, due_date, status, created_at',
          )
          .eq('customer_id', id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: null }),
    hasRetail
      ? ctx.supabase
          .from('sales')
          .select(
            'id, sale_number, sale_kind, status, total, completed_at, created_at',
          )
          .eq('customer_id', id)
          .is('deleted_at', null)
          .neq('status', 'voided')
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: null }),
    hasRepair
      ? ctx.supabase
          .from('repair_tickets')
          .select(
            'id, ticket_number, title, service_type, status, balance_due, created_at',
          )
          .eq('customer_id', id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: null }),
    hasRetail
      ? ctx.supabase
          .from('layaways')
          .select(
            'id, layaway_number, status, total_due, paid_total, balance_remaining, created_at',
          )
          .eq('customer_id', id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: null }),
  ])

  const loans = loanRows ?? []
  const sales = saleRows ?? []
  const repairs = repairRows ?? []
  const layaways = layawayRows ?? []

  // Loan events: sum interest paid, count extensions, compute on-time %.
  // Need to scope to this customer's loans only (loan_events has tenant_id
  // and a loan_id FK; we want only events where loan_id IN customer's loans).
  const loanIds = loans.map((l) => l.id)
  const { data: eventRows } =
    loanIds.length > 0
      ? await ctx.supabase
          .from('loan_events')
          .select(
            'id, loan_id, event_type, amount, principal_paid, interest_paid, fees_paid, payment_method, occurred_at',
          )
          .in('loan_id', loanIds)
          .order('occurred_at', { ascending: false })
      : { data: null }
  const events = eventRows ?? []

  // Forfeited (lost) pawns + their collateral, for the LOST PAWNS list.
  const forfeitedLoans = loans.filter((l) => l.status === 'forfeited')
  const forfeitedIds = forfeitedLoans.map((l) => l.id)
  const { data: collateralRows } =
    forfeitedIds.length > 0
      ? await ctx.supabase
          .from('loan_collateral_items')
          .select('loan_id, description, weight_grams, est_value, position')
          .in('loan_id', forfeitedIds)
          .is('deleted_at', null)
          .order('position', { ascending: true })
      : { data: null }
  const collateralByLoan = new Map<string, typeof collateralRows>()
  for (const c of collateralRows ?? []) {
    const arr = collateralByLoan.get(c.loan_id) ?? []
    arr.push(c)
    collateralByLoan.set(c.loan_id, arr)
  }
  const forfeited: ForfeitedLoanRow[] = forfeitedLoans.map((l) => ({
    id: l.id,
    ticket_number: l.ticket_number ?? '',
    principal: Number(l.principal),
    forfeited_at: l.created_at,
    items: (collateralByLoan.get(l.id) ?? []).map((c) => ({
      description: c.description,
      weight_grams: c.weight_grams == null ? null : Number(c.weight_grams),
      est_value: Number(c.est_value),
    })),
  }))

  // ─── LIFETIME STATS ─────────────────────────────────────────────────
  const totalPawns = loans.length
  const totalLoaned = loans.reduce((s, l) => s + Number(l.principal), 0)
  const activeLoans = loans.filter((l) =>
    ['active', 'extended', 'partial_paid'].includes(l.status as string),
  ).length
  const redeemedLoans = loans.filter((l) => l.status === 'redeemed').length
  const forfeitedLoansCount = forfeitedLoans.length

  const interestPaidLifetime = events
    .filter((e) => e.event_type === 'payment' || e.event_type === 'redemption')
    .reduce((s, e) => s + Number(e.interest_paid ?? 0), 0)

  const extensionCount = events.filter(
    (e) => e.event_type === 'extension',
  ).length

  // On-time %: of loans that finished (redeemed OR forfeited), how many
  // had a redemption event on/before due_date? Forfeited counts as off-time.
  // Find redemption events per loan.
  const redemptionByLoan = new Map<string, string>()
  for (const e of events) {
    if (e.event_type === 'redemption' && !redemptionByLoan.has(e.loan_id)) {
      redemptionByLoan.set(e.loan_id, e.occurred_at)
    }
  }
  let onTimeCount = 0
  let totalDecidedLoans = 0
  let lateDaysSum = 0
  let lateDaysCount = 0
  for (const l of loans) {
    if (l.status === 'redeemed') {
      totalDecidedLoans += 1
      const redeemedAt = redemptionByLoan.get(l.id)
      if (redeemedAt) {
        const due = new Date(`${l.due_date}T23:59:59Z`).getTime()
        const paid = new Date(redeemedAt).getTime()
        const daysLate = Math.round((paid - due) / (1000 * 60 * 60 * 24))
        if (daysLate <= 0) onTimeCount += 1
        if (daysLate > 0) {
          lateDaysSum += daysLate
          lateDaysCount += 1
        }
      }
    } else if (l.status === 'forfeited') {
      totalDecidedLoans += 1
      // Forfeited = off-time by definition.
    }
  }
  const onTimePct =
    totalDecidedLoans > 0
      ? Math.round((onTimeCount / totalDecidedLoans) * 100)
      : null
  const avgDaysLate =
    lateDaysCount > 0 ? Math.round((lateDaysSum / lateDaysCount) * 10) / 10 : null

  // ─── PAWN BEHAVIOR DERIVED METRICS ──────────────────────────────────
  const avgPrincipal =
    loans.length > 0 ? Math.round(totalLoaned / loans.length) : null
  // term_days isn't in the SELECT (would bloat) — we'll skip avg term in v1
  // and add it later if useful.
  const redemptionRatePct =
    totalDecidedLoans > 0
      ? Math.round((redeemedLoans / totalDecidedLoans) * 100)
      : null
  const forfeitRatePct =
    totalDecidedLoans > 0
      ? Math.round((forfeitedLoansCount / totalDecidedLoans) * 100)
      : null
  const extensionRatePct =
    loans.length > 0
      ? Math.round(
          (loans.filter((l) =>
            ['extended'].includes(l.status as string) ||
            events.some(
              (e) => e.event_type === 'extension' && e.loan_id === l.id,
            ),
          ).length /
            loans.length) *
            100,
        )
      : null

  // ─── SALES + REPAIRS + LAYAWAYS ─────────────────────────────────────
  // For sales: 'completed' state only counts toward $spent. Returns net out.
  const completedSales = sales.filter((s) => s.status === 'completed')
  const totalSalesCount = completedSales.length
  const totalSpent = completedSales.reduce((s, x) => s + Number(x.total), 0)

  const totalRepairs = repairs.length
  const repairsActive = repairs.filter((r) =>
    ['intake', 'quoted', 'in_progress', 'needs_parts', 'tech_qa'].includes(
      r.status as string,
    ),
  ).length

  const totalLayaways = layaways.length
  const activeLayaways = layaways.filter((l) => l.status === 'active').length

  // ─── 12-MONTH TRENDS ────────────────────────────────────────────────
  // Bucket each module's createds (or completed for sales) into the last
  // 12 calendar months. Bucket key = 'YYYY-MM'.
  const now = new Date()
  const buckets: MonthlyBucket[] = []
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    })
    buckets.push({
      key,
      label,
      pawns: 0,
      sales: 0,
      repairs: 0,
      layaways: 0,
    })
  }
  const bucketByKey = new Map(buckets.map((b) => [b.key, b] as const))
  const toKey = (iso: string): string => {
    const d = new Date(iso)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  for (const l of loans) {
    const b = bucketByKey.get(toKey(l.created_at))
    if (b) b.pawns += 1
  }
  for (const s of completedSales) {
    const when = s.completed_at ?? s.created_at
    const b = bucketByKey.get(toKey(when))
    if (b) b.sales += 1
  }
  for (const r of repairs) {
    const b = bucketByKey.get(toKey(r.created_at))
    if (b) b.repairs += 1
  }
  for (const l of layaways) {
    const b = bucketByKey.get(toKey(l.created_at))
    if (b) b.layaways += 1
  }

  // ─── RECENT ACTIVITY (last 60 days, all modules) ────────────────────
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000
  const activity: ActivityEvent[] = []
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (t < sixtyDaysAgo) continue
    activity.push({
      kind: 'loan_event',
      id: e.id,
      occurred_at: e.occurred_at,
      label: e.event_type,
      amount: e.amount == null ? null : Number(e.amount),
      ticket_number:
        loans.find((l) => l.id === e.loan_id)?.ticket_number ?? null,
      detail: null,
    })
  }
  for (const s of sales) {
    const when = s.completed_at ?? s.created_at
    const t = new Date(when).getTime()
    if (t < sixtyDaysAgo) continue
    activity.push({
      kind: 'sale',
      id: s.id,
      occurred_at: when,
      label: s.status,
      amount: Number(s.total),
      ticket_number: s.sale_number ?? null,
      detail: s.sale_kind,
    })
  }
  for (const r of repairs) {
    const t = new Date(r.created_at).getTime()
    if (t < sixtyDaysAgo) continue
    activity.push({
      kind: 'repair',
      id: r.id,
      occurred_at: r.created_at,
      label: r.status,
      amount: r.balance_due == null ? null : Number(r.balance_due),
      ticket_number: r.ticket_number ?? null,
      detail: r.title,
    })
  }
  for (const l of layaways) {
    const t = new Date(l.created_at).getTime()
    if (t < sixtyDaysAgo) continue
    activity.push({
      kind: 'layaway',
      id: l.id,
      occurred_at: l.created_at,
      label: l.status,
      amount: Number(l.balance_remaining),
      ticket_number: l.layaway_number ?? null,
      detail: null,
    })
  }
  activity.sort(
    (a, b) =>
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  )

  return (
    <CustomerAnalyticsDashboard
      customer={{
        id: customer.id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        photo_url: photoSignedUrl,
        phone: customer.phone,
        email: customer.email,
        is_banned: !!customer.is_banned,
        banned_reason: customer.banned_reason,
        loyalty_points_balance: customer.loyalty_points_balance ?? 0,
        created_at: customer.created_at,
      }}
      gates={{ hasPawn, hasRepair, hasRetail }}
      lifetime={{
        totalPawns,
        totalLoaned,
        activeLoans,
        forfeitedLoansCount,
        totalSalesCount,
        totalSpent,
        totalRepairs,
        repairsActive,
        totalLayaways,
        activeLayaways,
        interestPaidLifetime,
        extensionCount,
        onTimePct,
      }}
      pawnBehavior={{
        avgPrincipal,
        redemptionRatePct,
        forfeitRatePct,
        extensionRatePct,
        avgDaysLate,
      }}
      trends={buckets}
      forfeited={forfeited}
      activity={activity.slice(0, 50)}
    />
  )
}
