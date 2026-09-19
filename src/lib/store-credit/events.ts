// src/lib/store-credit/events.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { StoreCreditEventKind } from '@/types/database-aliases'
import { r4, toMoney } from './math'

type AdminClient = SupabaseClient<Database>

/**
 * Stable error tokens. The DB raises these verbatim from
 * patches/0053-store-credit.sql, and the UI translates them through
 * t.storeCredit.errors — no raw Postgres text ever reaches a clerk.
 */
export const STORE_CREDIT_ERRORS = [
  'store_credit_invalid_amount',
  'store_credit_disabled',
  'store_credit_sale_not_found',
  'store_credit_sale_not_open',
  'store_credit_no_customer',
  'store_credit_customer_not_found',
  'store_credit_exceeds_balance_due',
  'store_credit_insufficient_balance',
  'store_credit_event_not_found',
] as const

export type StoreCreditError = (typeof STORE_CREDIT_ERRORS)[number]

/** Pick the token out of a Postgres error message, or fall back. */
function toToken(message: string | undefined): StoreCreditError | 'store_credit_failed' {
  if (!message) return 'store_credit_failed'
  const hit = STORE_CREDIT_ERRORS.find((tok) => message.includes(tok))
  return hit ?? 'store_credit_failed'
}

export async function isStoreCreditEnabled(
  admin: AdminClient,
  tenantId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('settings')
    .select('store_credit_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data?.store_credit_enabled === true
}

export async function readBalance(
  admin: AdminClient,
  customerId: string,
): Promise<number> {
  const { data } = await admin
    .from('customers')
    .select('store_credit_balance')
    .eq('id', customerId)
    .maybeSingle()
  return toMoney(data?.store_credit_balance)
}

// ── Issuing ───────────────────────────────────────────────────────────────

type IssueResult =
  | { ok: true; id: string }
  /** The idempotency index blocked a duplicate — the credit already exists.
   *  Treat as success: the customer has their money either way. */
  | { ok: 'duplicate' }
  | { ok: false; error: string }

/**
 * Write one ledger row. The AFTER INSERT trigger moves
 * customers.store_credit_balance; the CHECK (>= 0) rolls the whole parent
 * transaction back if a debit would overdraw.
 */
async function insertEvent(
  admin: AdminClient,
  row: Database['public']['Tables']['store_credit_events']['Insert'],
): Promise<IssueResult> {
  const { data, error } = await admin
    .from('store_credit_events')
    .insert(row)
    .select('id')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: 'duplicate' }
    console.error('[store-credit] insert failed', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, id: data.id }
}

/**
 * Refund a return as store credit instead of cash or card. Idempotent per
 * return: a double-submitted return form cannot issue the credit twice.
 */
export async function issueForReturn(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  returnId: string
  amount: number
  performedBy?: string | null
}): Promise<IssueResult> {
  const amount = r4(args.amount)
  if (!(amount > 0)) return { ok: false, error: 'store_credit_invalid_amount' }
  return insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'issue_return',
    amount_delta: amount,
    source_kind: 'return',
    source_id: args.returnId,
    reason: 'refund_to_store_credit',
    performed_by: args.performedBy ?? null,
  })
}

/**
 * Pay a buy-outright as store credit. Keyed to the first inventory item of
 * the purchase — the same id the compliance_log row points at, so the two
 * records navigate to each other.
 */
export async function issueForBuy(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  buyAnchorItemId: string
  amount: number
  performedBy?: string | null
}): Promise<IssueResult> {
  const amount = r4(args.amount)
  if (!(amount > 0)) return { ok: false, error: 'store_credit_invalid_amount' }
  return insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind: 'issue_buy',
    amount_delta: amount,
    source_kind: 'buy',
    source_id: args.buyAnchorItemId,
    reason: 'buy_outright_payout',
    performed_by: args.performedBy ?? null,
  })
}

/**
 * Staff issues or corrects credit by hand. Deliberately NOT idempotent —
 * two $20 goodwill credits on the same day are two real events.
 */
export async function adjustManual(args: {
  admin: AdminClient
  tenantId: string
  customerId: string
  amountDelta: number
  reason: string
  performedBy: string
}): Promise<IssueResult> {
  const delta = r4(args.amountDelta)
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: 'store_credit_invalid_amount' }
  }
  const kind: StoreCreditEventKind = delta > 0 ? 'issue_manual' : 'adjust_manual'
  return insertEvent(args.admin, {
    tenant_id: args.tenantId,
    customer_id: args.customerId,
    kind,
    amount_delta: delta,
    reason: args.reason,
    performed_by: args.performedBy,
  })
}

// ── Redeeming (RPC-backed — see the header of patches/0053) ───────────────

export type RedeemResult =
  | { ok: true; salePaymentId: string; eventId: string; newBalance: number }
  | { ok: false; error: StoreCreditError | 'store_credit_failed' }

/**
 * Spend store credit as a tender on an open sale.
 *
 * Three writes have to land together — the ledger debit, the sale_payments
 * row and the sales.paid_total roll-up — so this goes through the
 * store_credit_redeem_on_sale RPC rather than three PostgREST calls. The
 * caller MUST have guarded the role first (Rule 10): the function is
 * SECURITY DEFINER and granted to service_role only.
 */
export async function redeemOnSale(args: {
  admin: AdminClient
  tenantId: string
  saleId: string
  amount: number
  performedBy?: string | null
}): Promise<RedeemResult> {
  const { data, error } = await args.admin.rpc('store_credit_redeem_on_sale', {
    p_tenant_id: args.tenantId,
    p_sale_id: args.saleId,
    p_amount: r4(args.amount),
    p_performed_by: args.performedBy ?? undefined,
  })
  if (error) {
    console.error('[store-credit] redeem failed', error)
    return { ok: false, error: toToken(error.message) }
  }
  const row = data?.[0]
  if (!row) return { ok: false, error: 'store_credit_failed' }
  return {
    ok: true,
    salePaymentId: row.o_sale_payment_id,
    eventId: row.o_event_id,
    newBalance: toMoney(row.o_new_balance),
  }
}

export type UndoResult =
  | { ok: true; eventId: string; newBalance: number }
  | { ok: false; error: StoreCreditError | 'store_credit_failed' }

/** Reverse one redemption while the sale is still open. */
export async function undoSaleRedemption(args: {
  admin: AdminClient
  tenantId: string
  eventId: string
  performedBy?: string | null
}): Promise<UndoResult> {
  const { data, error } = await args.admin.rpc(
    'store_credit_undo_sale_redemption',
    {
      p_tenant_id: args.tenantId,
      p_event_id: args.eventId,
      p_performed_by: args.performedBy ?? undefined,
    },
  )
  if (error) {
    console.error('[store-credit] undo failed', error)
    return { ok: false, error: toToken(error.message) }
  }
  const row = data?.[0]
  if (!row) return { ok: false, error: 'store_credit_failed' }
  return { ok: true, eventId: row.o_event_id, newBalance: toMoney(row.o_new_balance) }
}

/**
 * Put back every un-reversed redemption on a sale. Called when a sale is
 * voided — the payment rows stay on the sale as history (same as the card
 * refund path), the credit goes back to the customer.
 */
export async function restoreForSale(args: {
  admin: AdminClient
  tenantId: string
  saleId: string
  performedBy?: string | null
}): Promise<{ restoredCount: number; restoredAmount: number }> {
  const { data, error } = await args.admin.rpc('store_credit_restore_for_sale', {
    p_tenant_id: args.tenantId,
    p_sale_id: args.saleId,
    p_performed_by: args.performedBy ?? undefined,
  })
  if (error) {
    // A void must not be blocked by a credit restore failing — surface it
    // loudly in the log and let the void stand, same as a failed card refund.
    console.error('[store-credit] restore failed', error)
    return { restoredCount: 0, restoredAmount: 0 }
  }
  const row = data?.[0]
  return {
    restoredCount: row?.o_restored_count ?? 0,
    restoredAmount: toMoney(row?.o_restored_amount),
  }
}
