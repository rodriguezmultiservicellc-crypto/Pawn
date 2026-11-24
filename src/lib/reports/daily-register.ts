/**
 * Daily register report — one row per register session in the date range.
 *
 * Cash: every cash movement while the drawer was open, from loadDrawerCash —
 * the SAME function the register close uses for "expected cash", so the
 * report and the close always agree (POS, pawn payments and loans, repair
 * payments, buys, consignor payouts). One drawer is open at a time, so a
 * drawer's cash is the shop's cash between its open and its close.
 * Card: sale_payments of the sales rung on that session.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { reportBounds } from './range'
import type { Database } from '@/types/database'
import type { ReportRange, ReportResult } from './types'
import { drawerCashNet, loadDrawerCash } from '@/lib/pos/drawer-cash'

export type DailyRegisterRow = {
  session_id: string
  tenant_id: string
  status: string
  opened_at: string
  closed_at: string | null
  opening_cash: number
  /** Cash in at the POS: sales, layaway payments, metal sales. */
  cash_sales: number
  /** Cash out at the POS: refunds, voided sales, layaway cancellations. */
  cash_refunds: number
  pawn_payments: number
  pawn_loans: number
  pawn_loan_voids: number
  repair_payments: number
  buys: number
  consignment_payouts: number
  /** Cash in less cash out while the drawer was open. */
  cash_net: number
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
  // The shop's day, not UTC's (REVIEW-2026-11-11 finding 10).
  const { fromIso, toExclusiveIso } = reportBounds(range)

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

  // Card per session: the sale_payments of the sales rung on it. PostgREST
  // has no group-by, so it is added up here; volumes are bounded.
  const { data: sessionSales, error: cardErr } =
    sessionIds.length > 0
      ? await supabase
          .from('sales')
          .select('register_session_id, sale_payments(amount, payment_method)')
          .in('register_session_id', sessionIds)
          .is('deleted_at', null)
      : { data: [], error: null }
  if (cardErr) throw new Error(`daily_register_card_failed: ${cardErr.message}`)

  const cardBySession = new Map<string, { cardSales: number; cardRefunds: number }>()
  for (const s of sessionSales ?? []) {
    const sid = s.register_session_id
    if (!sid) continue
    const acc = cardBySession.get(sid) ?? { cardSales: 0, cardRefunds: 0 }
    for (const p of s.sale_payments ?? []) {
      const amt = Number(p.amount)
      if (!isFinite(amt) || p.payment_method !== 'card') continue
      if (amt >= 0) acc.cardSales += amt
      else acc.cardRefunds += -amt
    }
    cardBySession.set(sid, acc)
  }

  // Cash per session: the drawer's own window, by the close's function.
  const cashBySession = await Promise.all(
    (sessions ?? []).map((s) =>
      loadDrawerCash({ supabase, tenantId: s.tenant_id, from: s.opened_at, to: s.closed_at }),
    ),
  )

  const rows: DailyRegisterRow[] = (sessions ?? []).map((s, i) => {
    const a = cardBySession.get(s.id) ?? { cardSales: 0, cardRefunds: 0 }
    const cash = cashBySession[i]
    return {
      session_id: s.id,
      tenant_id: s.tenant_id,
      status: s.status,
      opened_at: s.opened_at,
      closed_at: s.closed_at,
      opening_cash: Number(s.opening_cash),
      cash_sales: cash.posSales,
      cash_refunds: cash.posRefunds,
      pawn_payments: cash.pawnPayments,
      pawn_loans: cash.pawnLoans,
      pawn_loan_voids: cash.pawnLoanVoids,
      repair_payments: cash.repairPayments,
      buys: cash.buys,
      consignment_payouts: cash.consignment,
      cash_net: drawerCashNet(cash),
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
      acc.pawn_payments += r.pawn_payments
      acc.pawn_loans += r.pawn_loans
      acc.cash_net += r.cash_net
      acc.card_sales += r.card_sales
      acc.card_refunds += r.card_refunds
      acc.opening_cash += r.opening_cash
      return acc
    },
    {
      cash_sales: 0,
      cash_refunds: 0,
      pawn_payments: 0,
      pawn_loans: 0,
      cash_net: 0,
      card_sales: 0,
      card_refunds: 0,
      opening_cash: 0,
    },
  )

  // Online store sales (patches/0078): paid by card on the website, never
  // in a drawer, so they sit on their own line beside the session rows.
  const { data: online, error: onlineErr } = await supabase
    .from('sales')
    .select('total')
    .in('tenant_id', tenantIds as string[])
    .eq('channel', 'online')
    .is('deleted_at', null)
    .neq('status', 'voided')
    .gte('completed_at', fromIso)
    .lt('completed_at', toExclusiveIso)
  if (onlineErr) throw new Error(`daily_register_online_failed: ${onlineErr.message}`)
  const onlineTotals = {
    online_sales: (online ?? []).reduce((acc, s) => acc + Number(s.total), 0),
    online_count: (online ?? []).length,
  }

  return { rows, totals: { ...totals, ...onlineTotals }, tenantIds: [...tenantIds] }
}
