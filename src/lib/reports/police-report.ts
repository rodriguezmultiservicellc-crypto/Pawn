/**
 * Police-report query helper.
 *
 * Reads from compliance_log only (Rule 15). Returns the raw rows; the
 * format dispatcher converts them to the per-jurisdiction CSV format.
 *
 * The query filters by event_type IN ('pawn_intake','buy_outright') by
 * default. Some jurisdictions also report redemptions / forfeitures —
 * the caller can override via `eventTypes`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ComplianceLogRow } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export const POLICE_REPORT_DEFAULT_EVENT_TYPES = [
  'pawn_intake',
  'buy_outright',
] as const

export async function getPoliceReportRows(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
  eventTypes?: ReadonlyArray<string>
}): Promise<ReportResult<ComplianceLogRow>> {
  const { supabase, tenantIds, range } = args
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`
  const eventTypes = args.eventTypes ?? POLICE_REPORT_DEFAULT_EVENT_TYPES

  const { data, error } = await supabase
    .from('compliance_log')
    .select('*')
    .in('tenant_id', tenantIds as string[])
    .in('event_type', eventTypes as string[])
    .gte('occurred_at', fromIso)
    .lt('occurred_at', toExclusiveIso)
    .order('occurred_at', { ascending: false })

  if (error) throw new Error(`police_report_query_failed: ${error.message}`)

  const rows: ComplianceLogRow[] = (data ?? []) as ComplianceLogRow[]

  const totals = rows.reduce(
    (acc, r) => {
      acc.rows += 1
      if (r.event_type === 'pawn_intake') acc.pawn_intakes += 1
      if (r.event_type === 'buy_outright') acc.buy_outrights += 1
      acc.total_amount += r.amount == null ? 0 : Number(r.amount)
      return acc
    },
    {
      rows: 0,
      pawn_intakes: 0,
      buy_outrights: 0,
      total_amount: 0,
    } as Record<string, number>,
  )

  return { rows, totals, tenantIds: [...tenantIds] }
}
