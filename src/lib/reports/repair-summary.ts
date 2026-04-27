/**
 * Repair tickets summary — tickets created in the date range, grouped by
 * status with per-row detail.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { RepairStatus, ServiceType } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export type RepairSummaryRow = {
  ticket_id: string
  tenant_id: string
  ticket_number: string
  customer_name: string
  service_type: ServiceType
  status: RepairStatus
  title: string
  quote_amount: number | null
  deposit_amount: number
  paid_amount: number
  promised_date: string | null
  created_at: string
  completed_at: string | null
  picked_up_at: string | null
}

export async function getRepairSummary(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<ReportResult<RepairSummaryRow>> {
  const { supabase, tenantIds, range } = args
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`

  const { data, error } = await supabase
    .from('repair_tickets')
    .select(
      `id, tenant_id, ticket_number, service_type, status, title,
       quote_amount, deposit_amount, paid_amount, promised_date,
       created_at, completed_at, picked_up_at,
       customer:customers(first_name, last_name)`,
    )
    .in('tenant_id', tenantIds as string[])
    .is('deleted_at', null)
    .gte('created_at', fromIso)
    .lt('created_at', toExclusiveIso)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`repair_summary_query_failed: ${error.message}`)

  type Joined = {
    id: string
    tenant_id: string
    ticket_number: string | null
    service_type: ServiceType
    status: RepairStatus
    title: string
    quote_amount: number | string | null
    deposit_amount: number | string
    paid_amount: number | string
    promised_date: string | null
    created_at: string
    completed_at: string | null
    picked_up_at: string | null
    customer: { first_name: string; last_name: string } | null
  }

  const rows: RepairSummaryRow[] = ((data ?? []) as unknown as Joined[]).map(
    (t) => ({
      ticket_id: t.id,
      tenant_id: t.tenant_id,
      ticket_number: t.ticket_number ?? '',
      customer_name: t.customer
        ? `${t.customer.last_name}, ${t.customer.first_name}`
        : '—',
      service_type: t.service_type,
      status: t.status,
      title: t.title,
      quote_amount: t.quote_amount == null ? null : Number(t.quote_amount),
      deposit_amount: Number(t.deposit_amount),
      paid_amount: Number(t.paid_amount),
      promised_date: t.promised_date,
      created_at: t.created_at,
      completed_at: t.completed_at,
      picked_up_at: t.picked_up_at,
    }),
  )

  const totals = rows.reduce(
    (acc, r) => {
      acc.tickets += 1
      acc.deposits += r.deposit_amount
      acc.collected += r.paid_amount
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    },
    { tickets: 0, deposits: 0, collected: 0 } as Record<string, number>,
  )

  return { rows, totals, tenantIds: [...tenantIds] }
}
