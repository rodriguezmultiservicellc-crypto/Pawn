import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { payoffFromLoan, toMoney } from '@/lib/pawn/math'
import {
  bucketFor,
  daysBetweenIso,
  layawayStanding,
  summarize,
  type AgingConfig,
  type CollectionKpis,
  type CollectionRow,
  DEFAULT_AGING,
} from './aging'

type Client = SupabaseClient<Database>

/** How far back "average days to collect" and "promises kept" look. */
export const COLLECTIONS_LOOKBACK_DAYS = 90

export type CollectionsData = {
  rows: CollectionRow[]
  kpis: CollectionKpis
  config: AgingConfig
}

export async function loadAgingConfig(client: Client, tenantId: string): Promise<AgingConfig> {
  const { data } = await client
    .from('settings')
    .select('collections_slight_days, collections_very_days')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const slight = Number(data?.collections_slight_days)
  const very = Number(data?.collections_very_days)
  if (Number.isFinite(slight) && Number.isFinite(very) && very > slight && slight >= 1) {
    return { slightDays: slight, veryDays: very }
  }
  return DEFAULT_AGING
}

type CustomerLite = { id: string; first_name: string; last_name: string; phone: string | null } | null

function customerName(c: CustomerLite): string {
  return c ? `${c.last_name}, ${c.first_name}`.trim() : '—'
}

/**
 * Everyone who owes the shop money, from every source (brief Phase 4.3):
 *   loans     — active / extended / partial_paid, balance = payoff today
 *               (lib/pawn/math; the interest math itself is untouched),
 *               late = days past due_date
 *   layaways  — active with a balance, late = days since the first
 *               installment not covered by payments (lib/collections/aging)
 *   repairs   — ready or picked up with balance_due > 0, late = days past
 *               promised_date (ready) or since pickup (picked up)
 *
 * `today` is the shop's local calendar day (tenants.timezone).
 */
export async function loadCollections(args: {
  client: Client
  tenantId: string
  today: string
  config?: AgingConfig
}): Promise<CollectionsData> {
  const { client, tenantId, today } = args
  const config = args.config ?? (await loadAgingConfig(client, tenantId))
  const lookbackIso = new Date(Date.now() - COLLECTIONS_LOOKBACK_DAYS * 86_400_000).toISOString()

  const [loansRes, layawaysRes, repairsRes, redemptionsRes, doneLayawaysRes] = await Promise.all([
    client
      .from('loans')
      .select(
        'id, ticket_number, customer_id, principal, interest_rate_monthly, issue_date, due_date, min_monthly_charge, status, customer:customers(id, first_name, last_name, phone)',
      )
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('status', ['active', 'extended', 'partial_paid'])
      .order('due_date', { ascending: true })
      .limit(2000),
    client
      .from('layaways')
      .select(
        'id, layaway_number, customer_id, status, total_due, paid_total, balance_remaining, schedule_kind, down_payment, first_payment_due, final_due_date, customer:customers(id, first_name, last_name, phone)',
      )
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .gt('balance_remaining', 0)
      .limit(2000),
    client
      .from('repair_tickets')
      .select(
        'id, ticket_number, customer_id, status, balance_due, promised_date, picked_up_at, customer:customers(id, first_name, last_name, phone)',
      )
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('status', ['ready', 'picked_up'])
      .gt('balance_due', 0)
      .limit(2000),
    // Recent redemptions → "average days to collect" samples.
    client
      .from('loan_events')
      .select('occurred_at, loan:loans(due_date)')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'redemption')
      .gte('occurred_at', lookbackIso)
      .limit(2000),
    client
      .from('layaways')
      .select('completed_at, final_due_date')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('status', 'completed')
      .gte('completed_at', lookbackIso)
      .limit(2000),
  ])

  const rows: CollectionRow[] = []

  // ── Loans ──
  const loans = (loansRes.data ?? []) as unknown as Array<{
    id: string
    ticket_number: string | null
    customer_id: string
    principal: string | number
    interest_rate_monthly: string | number
    issue_date: string
    due_date: string
    min_monthly_charge: string | number | null
    status: string
    customer: CustomerLite
  }>
  if (loans.length > 0) {
    const { data: events } = await client
      .from('loan_events')
      .select('loan_id, principal_paid, interest_paid, fees_paid')
      .eq('tenant_id', tenantId)
      .in(
        'loan_id',
        loans.map((l) => l.id),
      )
    const byLoan = new Map<string, Array<{ principal_paid: number; interest_paid: number; fees_paid: number }>>()
    for (const e of events ?? []) {
      const list = byLoan.get(e.loan_id) ?? []
      list.push({
        principal_paid: Number(e.principal_paid ?? 0),
        interest_paid: Number(e.interest_paid ?? 0),
        fees_paid: Number(e.fees_paid ?? 0),
      })
      byLoan.set(e.loan_id, list)
    }
    for (const l of loans) {
      const payoff = payoffFromLoan(
        {
          principal: l.principal as never,
          interest_rate_monthly: l.interest_rate_monthly as never,
          issue_date: l.issue_date,
          min_monthly_charge: l.min_monthly_charge as never,
        },
        byLoan.get(l.id) ?? [],
        today,
      )
      const daysLate = Math.max(0, daysBetweenIso(l.due_date, today))
      rows.push({
        kind: 'loan',
        id: l.id,
        reference: l.ticket_number ?? '',
        customerId: l.customer_id,
        customerName: customerName(l.customer),
        phone: l.customer?.phone ?? null,
        balance: payoff.payoff,
        dueDate: l.due_date,
        daysLate,
        bucket: bucketFor(daysLate, config),
        href: `/pawn/${l.id}`,
      })
    }
  }

  // ── Layaways ──
  let promisedDue = 0
  let promisedKept = 0
  const layaways = (layawaysRes.data ?? []) as unknown as Array<{
    id: string
    layaway_number: string | null
    customer_id: string
    total_due: string | number
    paid_total: string | number
    balance_remaining: string | number
    schedule_kind: string
    down_payment: string | number
    first_payment_due: string | null
    final_due_date: string | null
    customer: CustomerLite
  }>
  for (const l of layaways) {
    const standing = layawayStanding(
      {
        scheduleKind: l.schedule_kind,
        firstPaymentDue: l.first_payment_due,
        finalDueDate: l.final_due_date,
        totalDue: toMoney(l.total_due),
        downPayment: toMoney(l.down_payment),
        paidTotal: toMoney(l.paid_total),
      },
      today,
    )
    promisedDue += standing.dueSoFar
    promisedKept += Math.min(standing.dueSoFar, standing.coveredSoFar)
    const nextDue =
      standing.dueDates.find((d) => d > today) ??
      (standing.dueDates.length > 0 ? standing.dueDates[standing.dueDates.length - 1] : l.final_due_date)
    rows.push({
      kind: 'layaway',
      id: l.id,
      reference: l.layaway_number ?? '',
      customerId: l.customer_id,
      customerName: customerName(l.customer),
      phone: l.customer?.phone ?? null,
      balance: toMoney(l.balance_remaining),
      dueDate: standing.daysLate > 0 ? standing.dueDates[standing.coveredSoFar] ?? l.final_due_date : nextDue,
      daysLate: standing.daysLate,
      bucket: bucketFor(standing.daysLate, config),
      href: `/pos/layaways/${l.id}`,
    })
  }

  // ── Repairs ──
  const repairs = (repairsRes.data ?? []) as unknown as Array<{
    id: string
    ticket_number: string | null
    customer_id: string
    status: string
    balance_due: string | number
    promised_date: string | null
    picked_up_at: string | null
    customer: CustomerLite
  }>
  for (const r of repairs) {
    const anchor =
      r.status === 'picked_up' && r.picked_up_at ? r.picked_up_at.slice(0, 10) : r.promised_date
    const daysLate = anchor ? Math.max(0, daysBetweenIso(anchor, today)) : 0
    rows.push({
      kind: 'repair',
      id: r.id,
      reference: r.ticket_number ?? '',
      customerId: r.customer_id,
      customerName: customerName(r.customer),
      phone: r.customer?.phone ?? null,
      balance: toMoney(r.balance_due),
      dueDate: anchor,
      daysLate,
      bucket: bucketFor(daysLate, config),
      href: `/repair/${r.id}`,
    })
  }

  // ── Average days to collect (recent redemptions + completed layaways) ──
  const samples: number[] = []
  for (const e of (redemptionsRes.data ?? []) as unknown as Array<{ occurred_at: string; loan: { due_date: string } | null }>) {
    if (!e.loan?.due_date) continue
    samples.push(Math.max(0, daysBetweenIso(e.loan.due_date, e.occurred_at.slice(0, 10))))
  }
  for (const l of doneLayawaysRes.data ?? []) {
    if (!l.completed_at || !l.final_due_date) continue
    samples.push(Math.max(0, daysBetweenIso(l.final_due_date, l.completed_at.slice(0, 10))))
  }

  rows.sort((a, b) => b.daysLate - a.daysLate || b.balance - a.balance)

  return {
    rows,
    kpis: summarize(rows, { daysToCollectSamples: samples, promisedDue, promisedKept }),
    config,
  }
}
