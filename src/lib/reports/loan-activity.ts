/**
 * Loan activity report — redemptions, forfeitures, interest income.
 *
 * Source: loan_events. Filtered to event_type IN ('redemption','forfeiture',
 * 'payment') and occurred_at within the date range. We project a single
 * per-event row plus aggregates (so the totals tile shows interest income
 * for the period and a forfeiture count).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LoanEventType } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export type LoanActivityRow = {
  event_id: string
  tenant_id: string
  loan_id: string
  ticket_number: string
  customer_name: string
  event_type: LoanEventType
  amount: number
  principal_paid: number
  interest_paid: number
  fees_paid: number
  occurred_at: string
}

export async function getLoanActivity(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<ReportResult<LoanActivityRow>> {
  const { supabase, tenantIds, range } = args
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`

  const { data, error } = await supabase
    .from('loan_events')
    .select(
      `id, tenant_id, loan_id, event_type, amount,
       principal_paid, interest_paid, fees_paid, occurred_at,
       loan:loans(ticket_number, customer:customers(first_name, last_name))`,
    )
    .in('tenant_id', tenantIds as string[])
    .in('event_type', ['payment', 'redemption', 'forfeiture'])
    .gte('occurred_at', fromIso)
    .lt('occurred_at', toExclusiveIso)
    .order('occurred_at', { ascending: false })

  if (error) throw new Error(`loan_activity_query_failed: ${error.message}`)

  type Joined = {
    id: string
    tenant_id: string
    loan_id: string
    event_type: LoanEventType
    amount: number | string | null
    principal_paid: number | string
    interest_paid: number | string
    fees_paid: number | string
    occurred_at: string
    loan: {
      ticket_number: string | null
      customer: { first_name: string; last_name: string } | null
    } | null
  }

  const rows: LoanActivityRow[] = ((data ?? []) as unknown as Joined[]).map(
    (e) => ({
      event_id: e.id,
      tenant_id: e.tenant_id,
      loan_id: e.loan_id,
      ticket_number: e.loan?.ticket_number ?? '',
      customer_name: e.loan?.customer
        ? `${e.loan.customer.last_name}, ${e.loan.customer.first_name}`
        : '—',
      event_type: e.event_type,
      amount: e.amount == null ? 0 : Number(e.amount),
      principal_paid: Number(e.principal_paid),
      interest_paid: Number(e.interest_paid),
      fees_paid: Number(e.fees_paid),
      occurred_at: e.occurred_at,
    }),
  )

  const totals = rows.reduce(
    (acc, r) => {
      if (r.event_type === 'redemption') acc.redemptions += 1
      if (r.event_type === 'forfeiture') acc.forfeitures += 1
      acc.interest_income += r.interest_paid
      acc.principal_collected += r.principal_paid
      acc.fees_collected += r.fees_paid
      acc.total_collected += r.amount
      return acc
    },
    {
      redemptions: 0,
      forfeitures: 0,
      interest_income: 0,
      principal_collected: 0,
      fees_collected: 0,
      total_collected: 0,
    } as Record<string, number>,
  )

  return { rows, totals, tenantIds: [...tenantIds] }
}
