// src/lib/consignment/payables.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { PaymentMethod } from '@/types/database-aliases'
import { openBalance, toMoney } from './math'

type AdminClient = SupabaseClient<Database>

/**
 * Stable error tokens raised by consignment_pay_out() in
 * patches/0054-consignment.sql, translated through t.consignment.errors.
 */
export const CONSIGNMENT_ERRORS = [
  'consignment_consignor_not_found',
  'consignment_nothing_payable',
  'consignment_below_floor_price',
] as const

export type ConsignmentError = (typeof CONSIGNMENT_ERRORS)[number]

export function toConsignmentToken(
  message: string | undefined,
): ConsignmentError | 'consignment_failed' {
  if (!message) return 'consignment_failed'
  return (
    CONSIGNMENT_ERRORS.find((tok) => message.includes(tok)) ??
    'consignment_failed'
  )
}

export async function isConsignmentEnabled(
  admin: AdminClient,
  tenantId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('settings')
    .select('consignment_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data?.consignment_enabled === true
}

export async function defaultCommissionPct(
  admin: AdminClient,
  tenantId: string,
): Promise<number> {
  const { data } = await admin
    .from('settings')
    .select('consignment_default_commission_pct')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const pct = toMoney(data?.consignment_default_commission_pct)
  return pct > 0 && pct <= 1 ? pct : 0.2
}

/**
 * What the shop currently owes one consignor. Reads the ledger rather than
 * a cached column: payables are written by triggers, and a stale cache on a
 * money figure is worse than one extra query.
 */
export async function consignorBalance(
  admin: AdminClient,
  args: { tenantId: string; consignorId: string },
): Promise<number> {
  const { data } = await admin
    .from('consignment_payables')
    .select('payable_amount, status')
    .eq('tenant_id', args.tenantId)
    .eq('consignor_id', args.consignorId)
    .eq('status', 'open')
  return openBalance(data ?? [])
}

/** Open balances for many consignors at once — for the list page. */
export async function consignorBalances(
  admin: AdminClient,
  args: { tenantId: string; consignorIds: string[] },
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (args.consignorIds.length === 0) return out
  const { data } = await admin
    .from('consignment_payables')
    .select('consignor_id, payable_amount, status')
    .eq('tenant_id', args.tenantId)
    .eq('status', 'open')
    .in('consignor_id', args.consignorIds)
  for (const row of data ?? []) {
    const prev = out.get(row.consignor_id) ?? 0
    out.set(row.consignor_id, prev + toMoney(row.payable_amount))
  }
  for (const [k, v] of out) {
    out.set(k, Math.round((v + Number.EPSILON) * 10000) / 10000)
  }
  return out
}

export type ConsignorOption = { id: string; label: string }

/**
 * Active consignors for a picker, labelled "CN-000001 — Last, First" (or
 * the business name when there is one). Inactive consignors are left out:
 * new goods should not be taken in under a closed account.
 */
export async function loadConsignorOptions(
  admin: AdminClient,
  tenantId: string,
): Promise<ConsignorOption[]> {
  const { data } = await admin
    .from('consignors')
    .select(
      'id, consignor_number, business_name, customer:customers(first_name, last_name)',
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('consignor_number', { ascending: true })

  type Row = {
    id: string
    consignor_number: string | null
    business_name: string | null
    customer: { first_name: string; last_name: string } | null
  }

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const person = row.customer
      ? `${row.customer.last_name}, ${row.customer.first_name}`
      : ''
    const name = row.business_name || person || row.id.slice(0, 8)
    return {
      id: row.id,
      label: row.consignor_number ? `${row.consignor_number} — ${name}` : name,
    }
  })
}

export type PayoutResult =
  | {
      ok: true
      payoutId: string
      payoutNumber: string
      amount: number
      rowCount: number
    }
  | { ok: false; error: ConsignmentError | 'consignment_failed' }

/**
 * Settle a consignor's whole open balance in one transaction: create the
 * payout, stamp every open row 'paid'. Refuses when the net is zero or
 * negative — a consignor who owes the shop does not get handed cash.
 *
 * Caller guards the role first (Rule 10); the RPC is service_role only.
 */
export async function payOutConsignor(args: {
  admin: AdminClient
  tenantId: string
  consignorId: string
  payoutMethod: PaymentMethod
  reference?: string | null
  performedBy?: string | null
}): Promise<PayoutResult> {
  const { data, error } = await args.admin.rpc('consignment_pay_out', {
    p_tenant_id: args.tenantId,
    p_consignor_id: args.consignorId,
    p_payout_method: args.payoutMethod,
    p_reference: args.reference ?? undefined,
    p_performed_by: args.performedBy ?? undefined,
  })
  if (error) {
    console.error('[consignment] payout failed', error)
    return { ok: false, error: toConsignmentToken(error.message) }
  }
  const row = data?.[0]
  if (!row) return { ok: false, error: 'consignment_failed' }
  return {
    ok: true,
    payoutId: row.o_payout_id,
    payoutNumber: row.o_payout_number,
    amount: toMoney(row.o_amount),
    rowCount: row.o_row_count,
  }
}
