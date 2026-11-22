/**
 * Tips — card reader tips in the date range, with a total per employee
 * (patches/0096).
 *
 * Source: sale_payments rows with tip_amount > 0, by occurred_at. A tip is
 * credited to the employee who ran the card payment (tip_user_id). A failed
 * card row never carries a tip (sale_card_payment_set_tip refuses it).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { reportBounds } from './range'
import type { Database } from '@/types/database'
import type { ReportRange } from './types'

export type TipRow = {
  payment_id: string
  tenant_id: string
  sale_id: string
  sale_number: string | null
  occurred_at: string
  tip: number
  /** What went toward the sale on the same card payment. */
  sale_amount: number
  card_last4: string | null
  employee_id: string | null
}

export type TipsByEmployee = { employee_id: string | null; count: number; total: number }

/** Totals per employee, largest first. Pure. */
export function tipsByEmployee(rows: ReadonlyArray<Pick<TipRow, 'employee_id' | 'tip'>>): TipsByEmployee[] {
  const by = new Map<string | null, TipsByEmployee>()
  for (const r of rows) {
    const cur = by.get(r.employee_id) ?? { employee_id: r.employee_id, count: 0, total: 0 }
    cur.count += 1
    cur.total = Math.round((cur.total + r.tip) * 100) / 100
    by.set(r.employee_id, cur)
  }
  return [...by.values()].sort((a, b) => b.total - a.total)
}

export async function getTips(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<{ rows: TipRow[]; byEmployee: TipsByEmployee[]; total: number }> {
  const { supabase, tenantIds, range } = args
  // The shop's day, not UTC's.
  const { fromIso, toExclusiveIso } = reportBounds(range)

  const { data, error } = await supabase
    .from('sale_payments')
    .select('id, tenant_id, sale_id, amount, tip_amount, tip_user_id, card_last4, occurred_at, sale:sales(sale_number)')
    .in('tenant_id', tenantIds as string[])
    .is('deleted_at', null)
    .gt('tip_amount', 0)
    .gte('occurred_at', fromIso)
    .lt('occurred_at', toExclusiveIso)
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(`tips_query_failed: ${error.message}`)

  type Joined = {
    id: string
    tenant_id: string
    sale_id: string
    amount: number | string
    tip_amount: number | string
    tip_user_id: string | null
    card_last4: string | null
    occurred_at: string
    sale: { sale_number: string | null } | null
  }
  const rows: TipRow[] = ((data ?? []) as unknown as Joined[]).map((p) => ({
    payment_id: p.id,
    tenant_id: p.tenant_id,
    sale_id: p.sale_id,
    sale_number: p.sale?.sale_number ?? null,
    occurred_at: p.occurred_at,
    tip: Number(p.tip_amount),
    sale_amount: Number(p.amount),
    card_last4: p.card_last4,
    employee_id: p.tip_user_id,
  }))
  const byEmployee = tipsByEmployee(rows)
  return { rows, byEmployee, total: Math.round(byEmployee.reduce((a, e) => a + e.total, 0) * 100) / 100 }
}
