import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import PawnContent, { type PawnListRow, type PawnStats } from './content'
import type { LoanStatus } from '@/types/database-aliases'
import {
  todayDateString,
  addDaysIso,
  daysBetween,
  appliedPayments,
  payoffBalance,
} from '@/lib/pawn/math'

type SearchParams = Promise<{
  q?: string
  status?: string
  due?: string
  customer?: string
}>

const NON_TERMINAL_STATUSES: ReadonlyArray<LoanStatus> = [
  'active',
  'extended',
  'partial_paid',
]

export default async function PawnListPage(props: {
  searchParams: SearchParams
}) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const params = await props.searchParams
  const q = (params.q ?? '').trim()
  const statusFilter = (params.status ?? 'active') as LoanStatus | 'all' | 'dueSoon'
  const dueWindow = (params.due ?? 'all') as
    | 'all'
    | 'overdue'
    | 'dueSoon7'
    | 'dueSoon14'
  const customerFilter = (params.customer ?? '').trim()

  const today = todayDateString()
  const in7 = addDaysIso(today, 7)
  const in14 = addDaysIso(today, 14)

  // Embedded select pulls customer name in one round-trip.
  let query = ctx.supabase
    .from('loans')
    .select(
      `id, ticket_number, customer_id, principal, interest_rate_monthly,
       min_monthly_charge, term_days, issue_date, due_date, status,
       is_printed, created_at,
       customer:customers(id, first_name, last_name, phone)`,
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  // Status filter — special "active" pseudostatus = active|extended|partial_paid.
  if (statusFilter === 'active') {
    query = query.in('status', NON_TERMINAL_STATUSES)
  } else if (
    statusFilter === 'redeemed' ||
    statusFilter === 'forfeited' ||
    statusFilter === 'voided' ||
    statusFilter === 'extended' ||
    statusFilter === 'partial_paid'
  ) {
    query = query.eq('status', statusFilter)
  }
  // 'all' / 'dueSoon' fall through to no .eq() and rely on dueWindow.

  // Due-date window filter.
  if (dueWindow === 'overdue') {
    query = query.lt('due_date', today).in('status', NON_TERMINAL_STATUSES)
  } else if (dueWindow === 'dueSoon7') {
    query = query
      .gte('due_date', today)
      .lte('due_date', in7)
      .in('status', NON_TERMINAL_STATUSES)
  } else if (dueWindow === 'dueSoon14') {
    query = query
      .gte('due_date', today)
      .lte('due_date', in14)
      .in('status', NON_TERMINAL_STATUSES)
  }

  if (customerFilter) {
    query = query.eq('customer_id', customerFilter)
  }

  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => '\\' + m)
    query = query.or(`ticket_number.ilike.%${escaped}%`)
  }

  const { data: loans } = await query

  // Status counts (parallel) for the filter chips.
  const [
    { count: countActive },
    { count: countOverdue },
    { count: countDueSoon7 },
    { count: countRedeemed },
    { count: countForfeited },
    { count: countVoided },
  ] = await Promise.all([
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .lt('due_date', today),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .gte('due_date', today)
      .lte('due_date', in7),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'redeemed'),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'forfeited'),
    ctx.supabase
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'voided'),
  ])

  // Loan-math fields kept per id so payoff can be recomputed during enrichment.
  type LoanMathFields = {
    principal: number | string
    interest_rate_monthly: number | string
    issue_date: string
    min_monthly_charge: number | string | null
  }
  const mathById = new Map<string, LoanMathFields>()

  // Filter the list further by `q` against customer name OR phone (server-side
  // text search across embedded relations isn't trivial to express in
  // PostgREST; we filter in-memory — list is capped at 200 anyway).
  let rows: PawnListRow[] = (loans ?? []).map((l) => {
    const c = (l as unknown as { customer: { first_name: string; last_name: string; phone: string | null } | null }).customer
    const lm = l as unknown as LoanMathFields
    mathById.set(l.id, {
      principal: lm.principal,
      interest_rate_monthly: lm.interest_rate_monthly,
      issue_date: lm.issue_date,
      min_monthly_charge: lm.min_monthly_charge,
    })
    return {
      id: l.id,
      ticket_number: l.ticket_number ?? '',
      customer_id: l.customer_id,
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      customer_phone: c?.phone ?? null,
      principal: l.principal,
      interest_rate_monthly: l.interest_rate_monthly,
      term_days: l.term_days,
      issue_date: l.issue_date,
      due_date: l.due_date,
      status: l.status as LoanStatus,
      is_printed: l.is_printed,
      created_at: l.created_at,
      collateral_label: null,
      collateral_extra: 0,
      payoff: null,
      accrued_interest: null,
    }
  })

  if (q) {
    const ql = q.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.ticket_number.toLowerCase().includes(ql) ||
        r.customer_name.toLowerCase().includes(ql) ||
        (r.customer_phone ?? '').toLowerCase().includes(ql),
    )
  }

  // ── Book-wide stats strip (independent of the active filter) ───────────────
  const since30 = addDaysIso(today, -30)
  const [{ data: activeBook }, { data: redeemed30 }] = await Promise.all([
    ctx.supabase
      .from('loans')
      .select(
        'id, principal, interest_rate_monthly, issue_date, due_date, min_monthly_charge',
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .in('status', NON_TERMINAL_STATUSES)
      .limit(1000),
    ctx.supabase
      .from('loans')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .eq('status', 'redeemed')
      .gte('updated_at', since30)
      .limit(1000),
  ])

  type ActiveLoan = {
    id: string
    principal: number | string
    interest_rate_monthly: number | string
    issue_date: string
    due_date: string
    min_monthly_charge: number | string | null
  }
  const activeLoans = (activeBook ?? []) as unknown as ActiveLoan[]
  const redeemedIds = (redeemed30 ?? []).map((r) => r.id)

  // Single batched events fetch for every loan we need payoff/interest on:
  // the displayed rows + the active book + redeemed-in-30-days.
  const eventLoanIds = Array.from(
    new Set<string>([
      ...rows.map((r) => r.id),
      ...activeLoans.map((l) => l.id),
      ...redeemedIds,
    ]),
  )

  type EventLite = {
    principal_paid: number
    interest_paid: number
    fees_paid: number
  }
  const eventsByLoan = new Map<string, EventLite[]>()
  if (eventLoanIds.length) {
    const { data: evRows } = await ctx.supabase
      .from('loan_events')
      .select('loan_id, principal_paid, interest_paid, fees_paid')
      .in('loan_id', eventLoanIds)
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

  // Collateral summary (first description + extra count) for displayed rows.
  const collateralByLoan = new Map<
    string,
    { label: string; extra: number }
  >()
  if (rows.length) {
    const { data: collatRows } = await ctx.supabase
      .from('loan_collateral_items')
      .select('loan_id, description, position')
      .in(
        'loan_id',
        rows.map((r) => r.id),
      )
      .is('deleted_at', null)
      .order('position', { ascending: true })
    for (const cRow of (collatRows ?? []) as unknown as {
      loan_id: string
      description: string | null
    }[]) {
      const cur = collateralByLoan.get(cRow.loan_id)
      if (cur) cur.extra += 1
      else
        collateralByLoan.set(cRow.loan_id, {
          label: cRow.description ?? '—',
          extra: 0,
        })
    }
  }

  // Enrich displayed rows with collateral label + payoff (open loans only).
  const TERMINAL: ReadonlyArray<LoanStatus> = ['redeemed', 'forfeited', 'voided']
  for (const r of rows) {
    const summary = collateralByLoan.get(r.id)
    if (summary) {
      r.collateral_label = summary.label
      r.collateral_extra = summary.extra
    }
    if (!TERMINAL.includes(r.status)) {
      const m = mathById.get(r.id)
      if (m) {
        const po = payoffBalance({
          principal: typeof m.principal === 'string' ? parseFloat(m.principal) : m.principal,
          monthlyRate:
            typeof m.interest_rate_monthly === 'string'
              ? parseFloat(m.interest_rate_monthly)
              : m.interest_rate_monthly,
          issueDate: m.issue_date,
          today,
          events: eventsByLoan.get(r.id) ?? [],
          minMonthlyCharge:
            m.min_monthly_charge == null
              ? null
              : typeof m.min_monthly_charge === 'string'
              ? parseFloat(m.min_monthly_charge)
              : m.min_monthly_charge,
        })
        r.payoff = po.payoff
        r.accrued_interest = po.interestOutstanding
      }
    }
  }

  // Aggregate the stats strip from the active book + redeemed-30d.
  let onLoanNow = 0
  let dueSoonCount = 0
  let dueSoonValue = 0
  let overdueCount = 0
  let overdueValue = 0
  for (const l of activeLoans) {
    const po = payoffBalance({
      principal: typeof l.principal === 'string' ? parseFloat(l.principal) : l.principal,
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
    onLoanNow += po.principalOutstanding
    const d = daysBetween(today, l.due_date)
    if (d < 0) {
      overdueCount += 1
      overdueValue += po.payoff
    } else if (d <= 7) {
      dueSoonCount += 1
      dueSoonValue += po.payoff
    }
  }

  let redeemedInterest = 0
  for (const id of redeemedIds) {
    redeemedInterest += appliedPayments(eventsByLoan.get(id) ?? []).interestApplied
  }

  const stats: PawnStats = {
    onLoanNow,
    activeCount: activeLoans.length,
    dueSoonCount,
    dueSoonValue,
    overdueCount,
    overdueValue,
    redeemedCount: redeemedIds.length,
    redeemedInterest,
  }

  return (
    <PawnContent
      rows={rows}
      query={q}
      statusFilter={statusFilter}
      dueWindow={dueWindow}
      customerFilter={customerFilter}
      counts={{
        active: countActive ?? 0,
        overdue: countOverdue ?? 0,
        dueSoon7: countDueSoon7 ?? 0,
        redeemed: countRedeemed ?? 0,
        forfeited: countForfeited ?? 0,
        voided: countVoided ?? 0,
      }}
      stats={stats}
      today={today}
    />
  )
}
