/**
 * Pawn aging report — active loans bucketed by days-to-due (or days-overdue).
 *
 * Source: loans + customers. Filtered to non-terminal statuses; the date
 * range filters by `due_date` (so an "as of" view emerges when the user
 * picks a from = today, to = today+30).
 *
 * Buckets: -∞..-1 (overdue), 0..7, 8..14, 15..30, 31..60, 61..90, 90+.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LoanStatus } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'
import { todayDateString } from '@/lib/pawn/math'

const NON_TERMINAL: ReadonlyArray<LoanStatus> = [
  'active',
  'extended',
  'partial_paid',
]

export type PawnAgingBucket =
  | 'overdue'
  | 'due_0_7'
  | 'due_8_14'
  | 'due_15_30'
  | 'due_31_60'
  | 'due_61_90'
  | 'due_90_plus'

export type PawnAgingRow = {
  loan_id: string
  tenant_id: string
  ticket_number: string
  customer_name: string
  customer_phone: string | null
  principal: number
  interest_rate_monthly: number
  term_days: number
  issue_date: string
  due_date: string
  status: LoanStatus
  days_to_due: number
  bucket: PawnAgingBucket
}

function bucketOf(days: number): PawnAgingBucket {
  if (days < 0) return 'overdue'
  if (days <= 7) return 'due_0_7'
  if (days <= 14) return 'due_8_14'
  if (days <= 30) return 'due_15_30'
  if (days <= 60) return 'due_31_60'
  if (days <= 90) return 'due_61_90'
  return 'due_90_plus'
}

export async function getPawnAging(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<ReportResult<PawnAgingRow>> {
  const { supabase, tenantIds, range } = args

  const { data, error } = await supabase
    .from('loans')
    .select(
      `id, tenant_id, ticket_number, principal, interest_rate_monthly,
       term_days, issue_date, due_date, status,
       customer:customers(first_name, last_name, phone)`,
    )
    .in('tenant_id', tenantIds as string[])
    .is('deleted_at', null)
    .in('status', [...NON_TERMINAL])
    .gte('due_date', range.from)
    .lte('due_date', range.to)
    .order('due_date', { ascending: true })

  if (error) throw new Error(`pawn_aging_query_failed: ${error.message}`)

  const today = todayDateString()
  const todayMs = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  )

  const rows: PawnAgingRow[] = (data ?? []).map((l) => {
    const c = (l as unknown as {
      customer: { first_name: string; last_name: string; phone: string | null } | null
    }).customer
    const dueMs = Date.UTC(
      Number(l.due_date.slice(0, 4)),
      Number(l.due_date.slice(5, 7)) - 1,
      Number(l.due_date.slice(8, 10)),
    )
    const days = Math.round((dueMs - todayMs) / 86400000)
    return {
      loan_id: l.id,
      tenant_id: l.tenant_id,
      ticket_number: l.ticket_number ?? '',
      customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
      customer_phone: c?.phone ?? null,
      principal: Number(l.principal),
      interest_rate_monthly: Number(l.interest_rate_monthly),
      term_days: l.term_days,
      issue_date: l.issue_date,
      due_date: l.due_date,
      status: l.status as LoanStatus,
      days_to_due: days,
      bucket: bucketOf(days),
    }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.principal += r.principal
      acc[r.bucket] = (acc[r.bucket] ?? 0) + 1
      return acc
    },
    { principal: 0 } as Record<string, number>,
  )

  return { rows, totals, tenantIds: [...tenantIds] }
}
