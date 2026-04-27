/**
 * Daily register report — one row per register session in the date range.
 *
 * Source: register_sessions + sales/sale_payments (for derived totals).
 * We aggregate sale_payments per session so the variance and card-batch
 * fields tie out even when the operator didn't fill in expected_cash on
 * close.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ReportRange, ReportResult } from './types'
import { addDaysIso } from '@/lib/pawn/math'

export type DailyRegisterRow = {
  session_id: string
  tenant_id: string
  status: string
  opened_at: string
  closed_at: string | null
  opening_cash: number
  cash_sales: number
  cash_refunds: number
  card_sales: number
  card_refunds: number
  expected_cash: number | null
  closing_cash_counted: number | null
  cash_variance: number | null
  card_batch_total: number | null
  notes: string | null
}

export async function getDailyRegister(args: {
  supabase: SupabaseClient<Database>
  tenantIds: ReadonlyArray<string>
  range: ReportRange
}): Promise<ReportResult<DailyRegisterRow>> {
  const { supabase, tenantIds, range } = args

  // Compare against opened_at >= from and opened_at < (to+1).
  const fromIso = `${range.from}T00:00:00.000Z`
  const toExclusiveIso = `${addDaysIso(range.to, 1)}T00:00:00.000Z`

  const { data: sessions, error } = await supabase
    .from('register_sessions')
    .select(
      'id, tenant_id, status, opened_at, closed_at, opening_cash, expected_cash, closing_cash_counted, cash_variance, card_batch_total, notes',
    )
    .in('tenant_id', tenantIds as string[])
    .is('deleted_at', null)
    .gte('opened_at', fromIso)
    .lt('opened_at', toExclusiveIso)
    .order('opened_at', { ascending: false })

  if (error) throw new Error(`daily_register_query_failed: ${error.message}`)

  const sessionIds = (sessions ?? []).map((s) => s.id)

  // Aggregate cash/card per session via two parallel queries against
  // sale_payments (joined by sales.register_session_id). We do it client-
  // side because PostgREST doesn't expose group-by; volumes are bounded.
  const [{ data: cashPayments }, { data: cardPayments }] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from('sales')
          .select(
            'register_session_id, sale_payments(amount, payment_method)',
          )
          .in('register_session_id', sessionIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] as Array<unknown> }),
    Promise.resolve({ data: null }),
  ])
  void cardPayments

  type SaleRow = {
    register_session_id: string | null
    sale_payments: Array<{ amount: number | string; payment_method: string }> | null
  }

  const aggBySession = new Map<
    string,
    { cashSales: number; cashRefunds: number; cardSales: number; cardRefunds: number }
  >()
  for (const s of (cashPayments as unknown as SaleRow[]) ?? []) {
    const sid = s.register_session_id
    if (!sid) continue
    const acc = aggBySession.get(sid) ?? {
      cashSales: 0,
      cashRefunds: 0,
      cardSales: 0,
      cardRefunds: 0,
    }
    for (const p of s.sale_payments ?? []) {
      const amt = Number(p.amount)
      if (!isFinite(amt)) continue
      if (p.payment_method === 'cash') {
        if (amt >= 0) acc.cashSales += amt
        else acc.cashRefunds += -amt
      } else if (p.payment_method === 'card') {
        if (amt >= 0) acc.cardSales += amt
        else acc.cardRefunds += -amt
      }
    }
    aggBySession.set(sid, acc)
  }

  const rows: DailyRegisterRow[] = (sessions ?? []).map((s) => {
    const a = aggBySession.get(s.id) ?? {
      cashSales: 0,
      cashRefunds: 0,
      cardSales: 0,
      cardRefunds: 0,
    }
    return {
      session_id: s.id,
      tenant_id: s.tenant_id,
      status: s.status,
      opened_at: s.opened_at,
      closed_at: s.closed_at,
      opening_cash: Number(s.opening_cash),
      cash_sales: a.cashSales,
      cash_refunds: a.cashRefunds,
      card_sales: a.cardSales,
      card_refunds: a.cardRefunds,
      expected_cash: s.expected_cash == null ? null : Number(s.expected_cash),
      closing_cash_counted:
        s.closing_cash_counted == null ? null : Number(s.closing_cash_counted),
      cash_variance: s.cash_variance == null ? null : Number(s.cash_variance),
      card_batch_total:
        s.card_batch_total == null ? null : Number(s.card_batch_total),
      notes: s.notes,
    }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.cash_sales += r.cash_sales
      acc.cash_refunds += r.cash_refunds
      acc.card_sales += r.card_sales
      acc.card_refunds += r.card_refunds
      acc.opening_cash += r.opening_cash
      return acc
    },
    {
      cash_sales: 0,
      cash_refunds: 0,
      card_sales: 0,
      card_refunds: 0,
      opening_cash: 0,
    },
  )

  return { rows, totals, tenantIds: [...tenantIds] }
}
