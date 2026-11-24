/**
 * The cash that went into and out of the drawer while it was open — what
 * "expected cash" at register close is made of, and what the Daily register
 * report shows line by line. ONE place: the close, the open-drawer card on
 * POS and the report all call loadDrawerCash, so they cannot disagree.
 *
 * One drawer is open at a time (Eddy, 2026-11-24), so a drawer's cash is
 * every cash movement of the shop between its opening and its close.
 *
 * Where each line comes from (all cash only; card, check, transfer and store
 * credit never touch the drawer):
 *
 *   IN   posSales        sale_payments — POS sales, layaway payments (the
 *                        layaway function writes every layaway payment
 *                        there too: never add layaway_payments on top),
 *                        metal sales
 *   OUT  posRefunds      returns refunded in cash; layaway cancellation
 *                        refunds (a negative layaway_payments row, the one
 *                        layaway money NOT mirrored in sale_payments);
 *                        sales voided in the window — their cash payments,
 *                        less what a cash return already gave back
 *   IN   pawnPayments    loan_events payments (Pay together included); a
 *                        voided payment's reversal row is negative and nets
 *                        it out (rule 23)
 *   OUT  pawnLoans       principal of loans written in the window (Pawn
 *                        hands the loan out in cash; imported loans never)
 *   IN   pawnLoanVoids   principal of a Pawn-made loan voided in the window
 *                        — the customer hands the loan back
 *   IN   repairPayments  repair deposits and pickup payments
 *                        (repair_ticket_events.payment_method, patches/0113)
 *   OUT  buys            buy_payouts (patches/0113)
 *   OUT  consignment     consignment_payouts
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { allRows } from '@/lib/reports/all-rows'

export type DrawerCashLines = {
  /** In. */
  posSales: number
  /** Out (a positive number is money that left the drawer). */
  posRefunds: number
  pawnPayments: number
  pawnLoans: number
  pawnLoanVoids: number
  repairPayments: number
  buys: number
  consignment: number
}

export const DRAWER_LINES_IN = ['posSales', 'pawnPayments', 'pawnLoanVoids', 'repairPayments'] as const
export const DRAWER_LINES_OUT = ['posRefunds', 'pawnLoans', 'buys', 'consignment'] as const

const r4 = (x: number): number => Math.round(x * 10000) / 10000
const n = (v: number | string | null | undefined): number => {
  const x = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

export function emptyDrawerCash(): DrawerCashLines {
  return { posSales: 0, posRefunds: 0, pawnPayments: 0, pawnLoans: 0, pawnLoanVoids: 0, repairPayments: 0, buys: 0, consignment: 0 }
}

/** Cash in less cash out. */
export function drawerCashNet(l: DrawerCashLines): number {
  const ins = DRAWER_LINES_IN.reduce((s, k) => s + l[k], 0)
  const outs = DRAWER_LINES_OUT.reduce((s, k) => s + l[k], 0)
  return r4(ins - outs)
}

/** What should be in the drawer: the opening count plus the net. */
export function expectedDrawerCash(openingCash: number | string | null, l: DrawerCashLines): number {
  return r4(n(openingCash) + drawerCashNet(l))
}

/** The raw rows, as the loader reads them. Pure from here on. */
export type DrawerCashInput = {
  salePayments: Array<{ amount: number | string }>
  cashReturns: Array<{ total: number | string }>
  layawayRefunds: Array<{ amount: number | string }>
  /** Sales voided in the window, with ALL their payments and returns. */
  voidedSales: Array<{
    sale_payments: Array<{ amount: number | string; payment_method: string; deleted_at: string | null }> | null
    returns: Array<{ total: number | string; refund_method: string; deleted_at: string | null }> | null
  }>
  loanPayments: Array<{ amount: number | string | null }>
  loansWritten: Array<{ principal: number | string }>
  loansVoided: Array<{ principal: number | string }>
  repairPayments: Array<{ amount: number | string | null }>
  buyPayouts: Array<{ amount: number | string }>
  consignmentPayouts: Array<{ amount: number | string }>
}

export function summarizeDrawerCash(i: DrawerCashInput): DrawerCashLines {
  const sum = <T>(rows: ReadonlyArray<T>, f: (r: T) => number) => r4(rows.reduce((s, r) => s + f(r), 0))

  // A voided sale gives back the cash it took, less cash a return already
  // gave back for it (that return is counted on its own line).
  const voidedOut = sum(i.voidedSales, (s) => {
    const took = (s.sale_payments ?? [])
      .filter((p) => p.payment_method === 'cash' && p.deleted_at == null)
      .reduce((a, p) => a + n(p.amount), 0)
    const returned = (s.returns ?? [])
      .filter((r) => r.refund_method === 'cash' && r.deleted_at == null)
      .reduce((a, r) => a + n(r.total), 0)
    return Math.max(0, took - returned)
  })

  return {
    posSales: sum(i.salePayments, (p) => n(p.amount)),
    posRefunds: r4(
      sum(i.cashReturns, (r) => n(r.total)) + sum(i.layawayRefunds, (p) => -n(p.amount)) + voidedOut,
    ),
    pawnPayments: sum(i.loanPayments, (e) => n(e.amount)),
    pawnLoans: sum(i.loansWritten, (l) => n(l.principal)),
    pawnLoanVoids: sum(i.loansVoided, (l) => n(l.principal)),
    repairPayments: sum(i.repairPayments, (e) => n(e.amount)),
    buys: sum(i.buyPayouts, (p) => n(p.amount)),
    consignment: sum(i.consignmentPayouts, (p) => n(p.amount)),
  }
}

/**
 * Every cash movement of the shop in [from, to). `to` null = up to now (an
 * open drawer). Caller MUST have gated the tenant (requireRoleInTenant /
 * getCtx); every query also filters by tenant_id (rule 8).
 */
export async function loadDrawerCash(args: {
  supabase: SupabaseClient<Database>
  tenantId: string
  from: string
  to: string | null
}): Promise<DrawerCashLines> {
  const { supabase, tenantId, from } = args
  const to = args.to ?? new Date(Date.now() + 60_000).toISOString()

  const [
    salePayments,
    cashReturns,
    layawayRefunds,
    voidedSales,
    loanPayments,
    loansWritten,
    loanVoidEvents,
    repairPayments,
    buyPayouts,
    consignmentPayouts,
  ] = await Promise.all([
    allRows<{ amount: number }>('drawer_sale_payments', (a, b) =>
      supabase.from('sale_payments').select('amount, id').eq('tenant_id', tenantId)
        .eq('payment_method', 'cash').is('deleted_at', null)
        .gte('occurred_at', from).lt('occurred_at', to).order('id').range(a, b),
    ),
    allRows<{ total: number }>('drawer_returns', (a, b) =>
      supabase.from('returns').select('total, id').eq('tenant_id', tenantId)
        .eq('refund_method', 'cash').is('deleted_at', null)
        .gte('created_at', from).lt('created_at', to).order('id').range(a, b),
    ),
    allRows<{ amount: number }>('drawer_layaway_refunds', (a, b) =>
      supabase.from('layaway_payments').select('amount, id').eq('tenant_id', tenantId)
        .eq('payment_method', 'cash').lt('amount', 0).is('deleted_at', null)
        .gte('occurred_at', from).lt('occurred_at', to).order('id').range(a, b),
    ),
    allRows<DrawerCashInput['voidedSales'][number]>('drawer_voided_sales', (a, b) =>
      supabase.from('sales')
        .select('id, sale_payments(amount, payment_method, deleted_at), returns(total, refund_method, deleted_at)')
        .eq('tenant_id', tenantId).eq('status', 'voided').neq('channel', 'online')
        .gte('voided_at', from).lt('voided_at', to).order('id').range(a, b),
    ),
    allRows<{ amount: number | null }>('drawer_loan_payments', (a, b) =>
      supabase.from('loan_events').select('amount, id').eq('tenant_id', tenantId)
        .eq('event_type', 'payment').eq('payment_method', 'cash').is('legacy_ref', null)
        .gte('occurred_at', from).lt('occurred_at', to).order('id').range(a, b),
    ),
    allRows<{ principal: number }>('drawer_loans_written', (a, b) =>
      supabase.from('loans').select('principal, id').eq('tenant_id', tenantId)
        .is('legacy_ref', null).is('deleted_at', null)
        .gte('created_at', from).lt('created_at', to).order('id').range(a, b),
    ),
    allRows<{ loan: { principal: number; legacy_ref: string | null } | null }>('drawer_loan_voids', (a, b) =>
      supabase.from('loan_events').select('id, loan:loans(principal, legacy_ref)').eq('tenant_id', tenantId)
        .eq('event_type', 'void')
        .gte('occurred_at', from).lt('occurred_at', to).order('id').range(a, b),
    ),
    allRows<{ amount: number | null }>('drawer_repair_payments', (a, b) =>
      supabase.from('repair_ticket_events').select('amount, id').eq('tenant_id', tenantId)
        .eq('payment_method', 'cash')
        .gte('occurred_at', from).lt('occurred_at', to).order('id').range(a, b),
    ),
    allRows<{ amount: number }>('drawer_buy_payouts', (a, b) =>
      supabase.from('buy_payouts').select('amount, id').eq('tenant_id', tenantId)
        .eq('payout_method', 'cash')
        .gte('paid_at', from).lt('paid_at', to).order('id').range(a, b),
    ),
    allRows<{ amount: number }>('drawer_consignment_payouts', (a, b) =>
      supabase.from('consignment_payouts').select('amount, id').eq('tenant_id', tenantId)
        .eq('payout_method', 'cash')
        .gte('paid_at', from).lt('paid_at', to).order('id').range(a, b),
    ),
  ])

  return summarizeDrawerCash({
    salePayments,
    cashReturns,
    layawayRefunds,
    voidedSales,
    loanPayments,
    loansWritten,
    loansVoided: loanVoidEvents
      .filter((e) => e.loan != null && e.loan.legacy_ref == null)
      .map((e) => ({ principal: e.loan!.principal })),
    repairPayments,
    buyPayouts,
    consignmentPayouts,
  })
}
