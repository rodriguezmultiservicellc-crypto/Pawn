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
import { reportBounds } from './range'
import type { Database } from '@/types/database'
import type { ComplianceLogRow } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'

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
  // The shop's day, not UTC's (REVIEW-2026-11-11 finding 10).
  const { fromIso, toExclusiveIso } = reportBounds(range)
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

  // A ticket voided before it was reported is never reported (patches/0108):
  // drop its intake when it was withheld, or is still waiting for the export
  // with its void already in the log.
  const all = (data ?? []) as ComplianceLogRow[]
  const intakeIds = all.filter((r) => r.event_type === 'pawn_intake').map((r) => r.source_id)
  let voidedIds = new Set<string>()
  if (intakeIds.length > 0) {
    const { data: voids, error: vErr } = await supabase
      .from('compliance_log')
      .select('source_id')
      .in('tenant_id', tenantIds as string[])
      .eq('event_type', 'pawn_void')
      .in('source_id', intakeIds)
    if (vErr) throw new Error(`police_report_query_failed: ${vErr.message}`)
    voidedIds = new Set((voids ?? []).map((v) => v.source_id))
  }
  const rows = all.filter(
    (r) =>
      !(
        r.event_type === 'pawn_intake' &&
        voidedIds.has(r.source_id) &&
        (r.export_outcome === 'withheld_void' || r.exported_at == null)
      ),
  )

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

/** A ticket reported to the agency and voided afterwards: the shop must
 *  correct it with the agency (patches/0108). */
export type VoidedAfterReport = {
  loan_id: string
  ticket_number: string
  voided_at: string
  reported_at: string | null
  reported_batch_id: string | null
}

/**
 * Tickets voided after they were reported, newest first, from the last
 * `days` days. Read from compliance_log (rule 15); the ticket number is
 * looked up only to name the ticket on screen.
 */
export async function getVoidedAfterReport(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  days?: number
}): Promise<VoidedAfterReport[]> {
  const since = new Date(Date.now() - (args.days ?? 90) * 86_400_000).toISOString()
  const { data: voids, error } = await args.supabase
    .from('compliance_log')
    .select('source_id, occurred_at')
    .in('tenant_id', args.tenantIds as string[])
    .eq('event_type', 'pawn_void')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(`voided_after_report_query_failed: ${error.message}`)
  if (!voids || voids.length === 0) return []

  const loanIds = voids.map((v) => v.source_id)
  const [{ data: intakes }, { data: loans }] = await Promise.all([
    args.supabase
      .from('compliance_log')
      .select('source_id, exported_at, exported_batch_id, export_outcome')
      .in('tenant_id', args.tenantIds as string[])
      .eq('event_type', 'pawn_intake')
      .in('source_id', loanIds),
    args.supabase.from('loans').select('id, ticket_number').in('id', loanIds),
  ])
  return voids.flatMap((v) => {
    const intake = (intakes ?? []).find((i) => i.source_id === v.source_id)
    // Only a ticket that actually went out needs a correction.
    if (!intake?.exported_at || intake.export_outcome === 'withheld_void') return []
    return [
      {
        loan_id: v.source_id,
        ticket_number: (loans ?? []).find((l) => l.id === v.source_id)?.ticket_number ?? '',
        voided_at: v.occurred_at,
        reported_at: intake.exported_at,
        reported_batch_id: intake.exported_batch_id,
      },
    ]
  })
}

/**
 * Fetch a single tenant's UNEXPORTED reportable compliance_log rows
 * (exported_at IS NULL), ascending by occurrence. Used by the daily
 * LeadsOnline export cron — the exported_at stamp is the idempotency key,
 * so this captures every not-yet-reported transaction including backfill
 * from any missed day.
 */
export async function getUnexportedPoliceReportRows(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  eventTypes?: ReadonlyArray<string>
}): Promise<ComplianceLogRow[]> {
  // Voids ride along: the cron withholds or lists them (void-plan.ts).
  const eventTypes = [...(args.eventTypes ?? POLICE_REPORT_DEFAULT_EVENT_TYPES), 'pawn_void']

  const { data, error } = await args.supabase
    .from('compliance_log')
    .select('*')
    .eq('tenant_id', args.tenantId)
    .is('exported_at', null)
    .in('event_type', eventTypes as string[])
    .order('occurred_at', { ascending: true })

  if (error) {
    throw new Error(`unexported_police_report_query_failed: ${error.message}`)
  }
  return (data ?? []) as ComplianceLogRow[]
}
