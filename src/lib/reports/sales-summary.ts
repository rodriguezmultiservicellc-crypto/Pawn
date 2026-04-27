/**
 * Sales summary — completed sales in the date range with totals.
 *
 * Source: sales (status IN ('completed','partial_returned','fully_returned'))
 * filtered by completed_at within the range. Returns one row per sale.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SaleKind, SaleStatus } from '@/types/database-aliases'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export type SalesSummaryRow = {
  sale_id: string
  tenant_id: string
  sale_number: string
  sale_kind: SaleKind
  status: SaleStatus
  customer_name: string | null
  subtotal: number
  tax_amount: number
  discount_amount: number
  total: number
  paid_total: number
  returned_total: number
  net: number
  completed_at: string | null
}

export async function getSalesSummary(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<ReportResult<SalesSummaryRow>> {
  const { supabase, tenantIds, range } = args
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`

  const { data, error } = await supabase
    .from('sales')
    .select(
      `id, tenant_id, sale_number, sale_kind, status, subtotal, tax_amount,
       discount_amount, total, paid_total, returned_total, completed_at,
       customer:customers(first_name, last_name)`,
    )
    .in('tenant_id', tenantIds as string[])
    .is('deleted_at', null)
    .in('status', [
      'completed',
      'partial_returned',
      'fully_returned',
      'voided',
    ])
    .gte('completed_at', fromIso)
    .lt('completed_at', toExclusiveIso)
    .order('completed_at', { ascending: false })

  if (error) throw new Error(`sales_summary_query_failed: ${error.message}`)

  type Joined = {
    id: string
    tenant_id: string
    sale_number: string | null
    sale_kind: SaleKind
    status: SaleStatus
    subtotal: number | string
    tax_amount: number | string
    discount_amount: number | string
    total: number | string
    paid_total: number | string
    returned_total: number | string
    completed_at: string | null
    customer: { first_name: string; last_name: string } | null
  }

  const rows: SalesSummaryRow[] = ((data ?? []) as unknown as Joined[]).map(
    (s) => {
      const total = Number(s.total)
      const returned = Number(s.returned_total)
      return {
        sale_id: s.id,
        tenant_id: s.tenant_id,
        sale_number: s.sale_number ?? '',
        sale_kind: s.sale_kind,
        status: s.status,
        customer_name: s.customer
          ? `${s.customer.last_name}, ${s.customer.first_name}`
          : null,
        subtotal: Number(s.subtotal),
        tax_amount: Number(s.tax_amount),
        discount_amount: Number(s.discount_amount),
        total,
        paid_total: Number(s.paid_total),
        returned_total: returned,
        net: total - returned,
        completed_at: s.completed_at,
      }
    },
  )

  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === 'voided') {
        acc.voided_count += 1
        return acc
      }
      acc.units += 1
      acc.subtotal += r.subtotal
      acc.tax += r.tax_amount
      acc.discount += r.discount_amount
      acc.total += r.total
      acc.returned += r.returned_total
      acc.net += r.net
      return acc
    },
    {
      units: 0,
      voided_count: 0,
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      returned: 0,
      net: 0,
    } as Record<string, number>,
  )

  return { rows, totals, tenantIds: [...tenantIds] }
}
