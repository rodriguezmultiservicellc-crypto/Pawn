/**
 * Sale and layaway money movements — thin wrappers over the database
 * functions in patches/0076. The arithmetic, the row locks and the stock
 * flips all happen inside Postgres; nothing here reads a total, adds to it
 * and writes it back.
 *
 * Service role only. Every caller guards first (requireRoleInTenant, or the
 * webhook's signature + account checks) and passes the guarded tenant.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordEarnSale, maybeCreditReferral } from '@/lib/loyalty/events'
import { endListing } from '@/lib/ebay/listings'
import type { PaymentMethod } from '@/types/database-aliases'

type Fns = Database['public']['Functions']
type Admin = SupabaseClient<Database>

/** Error tokens the 0076 functions raise. Anything else maps to 'generic'. */
export const SALE_MONEY_ERRORS = [
  'sale_bad_kind',
  'cart_empty',
  'cart_too_large',
  'bad_tax_rate',
  'customer_required',
  'no_open_session',
  'customer_not_found',
  'bad_line',
  'duplicate_item',
  'inventory_out_of_stock',
  'use_store_credit_redeem',
  'bad_amount',
  'card_needs_payment_intent',
  'sale_not_found',
  'sale_not_open',
  'use_layaway_payment',
  'payment_exceeds_balance',
  'balance_remaining',
  'layaway_not_found',
  'layaway_not_active',
  'consignment_below_floor_price',
] as const
export type SaleMoneyError = (typeof SALE_MONEY_ERRORS)[number] | 'generic'

export function saleMoneyError(message: string | null | undefined): SaleMoneyError {
  const m = message ?? ''
  return SALE_MONEY_ERRORS.find((t) => m.includes(t)) ?? 'generic'
}

/** The t.pos.errors key the counter screens show for a refusal. */
export function posErrorKey(err: SaleMoneyError): string {
  switch (err) {
    case 'inventory_out_of_stock':
    case 'duplicate_item':
      return 'inventoryOutOfStock'
    case 'no_open_session':
      return 'noOpenSession'
    case 'cart_empty':
      return 'cartEmpty'
    case 'customer_required':
      return 'customerRequiredForLayaway'
    case 'sale_not_open':
      return 'saleNotOpen'
    case 'payment_exceeds_balance':
      return 'paymentExceedsBalance'
    case 'balance_remaining':
      return 'balanceRemaining'
    case 'layaway_not_active':
      return 'layawayNotActive'
    case 'consignment_below_floor_price':
      return 'consignmentBelowFloor'
    case 'bad_line':
    case 'bad_tax_rate':
    case 'bad_amount':
      return 'validationFailed'
    default:
      return 'generic'
  }
}

type Result<T> = { ok: true; data: T } | { ok: false; error: SaleMoneyError; message: string }

function fail<T>(where: string, message: string | undefined): Result<T> {
  console.error(`[pos.money] ${where}`, message)
  return { ok: false, error: saleMoneyError(message), message: message ?? '' }
}

export type SaleLineInput = {
  inventory_item_id: string | null
  description: string
  quantity: number
  unit_price: number
  line_discount: number
}

export async function saleCreate(args: {
  tenantId: string
  userId: string
  registerSessionId: string
  customerId: string | null
  taxRate: number
  discount: number
  notes: string | null
  items: SaleLineInput[]
}): Promise<Result<{ saleId: string; saleNumber: string | null; total: number }>> {
  const params = {
    p_tenant_id: args.tenantId,
    p_user_id: args.userId,
    p_register_session_id: args.registerSessionId,
    p_sale_kind: 'retail',
    p_customer_id: args.customerId,
    p_tax_rate: args.taxRate,
    p_discount: args.discount,
    p_notes: args.notes,
    p_items: args.items,
  } as unknown as Fns['sale_create']['Args']
  const { data, error } = await createAdminClient().rpc('sale_create', params)
  const row = data?.[0]
  if (error || !row) return fail('sale_create', error?.message)
  return { ok: true, data: { saleId: row.o_sale_id, saleNumber: row.o_sale_number, total: Number(row.o_total) } }
}

export async function layawayCreate(args: {
  tenantId: string
  userId: string
  registerSessionId: string
  customerId: string
  taxRate: number
  discount: number
  notes: string | null
  items: SaleLineInput[]
  scheduleKind: string
  downPayment: number
  downMethod: PaymentMethod
  firstPaymentDue: string | null
  finalDueDate: string | null
  cancellationFeePct: number
}): Promise<Result<{ saleId: string; layawayId: string; layawayNumber: string | null; total: number; completed: boolean }>> {
  const params = {
    p_tenant_id: args.tenantId,
    p_user_id: args.userId,
    p_register_session_id: args.registerSessionId,
    p_customer_id: args.customerId,
    p_tax_rate: args.taxRate,
    p_discount: args.discount,
    p_notes: args.notes,
    p_items: args.items,
    p_schedule_kind: args.scheduleKind,
    p_down_payment: args.downPayment,
    p_down_method: args.downMethod,
    p_first_payment_due: args.firstPaymentDue,
    p_final_due_date: args.finalDueDate,
    p_cancellation_fee: args.cancellationFeePct,
  } as unknown as Fns['layaway_create']['Args']
  const { data, error } = await createAdminClient().rpc('layaway_create', params)
  const row = data?.[0]
  if (error || !row) return fail('layaway_create', error?.message)
  return {
    ok: true,
    data: {
      saleId: row.o_sale_id,
      layawayId: row.o_layaway_id,
      layawayNumber: row.o_layaway_number,
      total: Number(row.o_total),
      completed: row.o_completed === true,
    },
  }
}

export async function saleAddPayment(args: {
  tenantId: string
  userId: string
  saleId: string
  amount: number
  method: PaymentMethod
  paymentIntentId: string | null
  readerId: string | null
  notes: string | null
}): Promise<Result<{ paymentId: string; counted: boolean; paidTotal: number; balance: number }>> {
  const params = {
    p_tenant_id: args.tenantId,
    p_sale_id: args.saleId,
    p_user_id: args.userId,
    p_amount: args.amount,
    p_method: args.method,
    p_stripe_pi: args.paymentIntentId,
    p_reader_id: args.readerId,
    p_notes: args.notes,
  } as unknown as Fns['sale_add_payment']['Args']
  const { data, error } = await createAdminClient().rpc('sale_add_payment', params)
  const row = data?.[0]
  if (error || !row) return fail('sale_add_payment', error?.message)
  return {
    ok: true,
    data: {
      paymentId: row.o_payment_id,
      counted: row.o_counted === true,
      paidTotal: Number(row.o_paid_total),
      balance: Number(row.o_balance),
    },
  }
}

export async function saleComplete(args: {
  tenantId: string
  userId: string | null
  saleId: string
}): Promise<Result<{ completed: boolean; reason: string }>> {
  const params = {
    p_tenant_id: args.tenantId,
    p_sale_id: args.saleId,
    p_user_id: args.userId,
  } as unknown as Fns['sale_complete']['Args']
  const { data, error } = await createAdminClient().rpc('sale_complete', params)
  const row = data?.[0]
  if (error || !row) return fail('sale_complete', error?.message)
  return { ok: true, data: { completed: row.o_completed === true, reason: row.o_reason } }
}

export type LayawayPaymentOutcome = {
  paymentId: string | null
  paidTotal: number
  balance: number
  completed: boolean
  /** applied | overpaid | duplicate | layaway_not_active */
  reason: string
  /** Charged but not applied — must be refunded (online payments only). */
  excess: number
}

export async function layawayAddPayment(args: {
  tenantId: string
  /** null for the Stripe webhook (system). */
  userId: string | null
  layawayId: string
  amount: number
  method: PaymentMethod
  cardStatus: Database['public']['Enums']['card_present_status']
  paymentIntentId?: string | null
  /** Set by the webhook only: makes the post idempotent and turns refusals into reasons. */
  stripeSessionId?: string | null
  notes?: string | null
}): Promise<Result<LayawayPaymentOutcome>> {
  const params = {
    p_tenant_id: args.tenantId,
    p_layaway_id: args.layawayId,
    p_user_id: args.userId,
    p_amount: args.amount,
    p_method: args.method,
    p_card_status: args.cardStatus,
    p_stripe_pi: args.paymentIntentId ?? null,
    p_stripe_session: args.stripeSessionId ?? null,
    p_notes: args.notes ?? null,
  } as unknown as Fns['layaway_add_payment']['Args']
  const { data, error } = await createAdminClient().rpc('layaway_add_payment', params)
  const row = data?.[0]
  if (error || !row) return fail('layaway_add_payment', error?.message)
  return {
    ok: true,
    data: {
      paymentId: row.o_payment_id,
      paidTotal: Number(row.o_paid_total),
      balance: Number(row.o_balance),
      completed: row.o_completed === true,
      reason: row.o_reason,
      excess: Number(row.o_excess ?? 0),
    },
  }
}

/**
 * What follows a completed sale outside the database: ending any live eBay
 * listing for a piece that just sold, loyalty points and a referral bonus
 * (both idempotent — loyalty_events_idempotency). Called by every path that
 * can complete a sale: the counter, a layaway paid off at the counter or
 * online, and an online store order.
 */
export async function afterSaleCompleted(args: { admin?: Admin; tenantId: string; saleId: string }): Promise<void> {
  const admin = args.admin ?? createAdminClient()
  await endEbayListingsForSale(admin, args.tenantId, args.saleId)
  const { data: sale } = await admin
    .from('sales')
    .select('customer_id, subtotal, status')
    .eq('id', args.saleId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (!sale?.customer_id || sale.status !== 'completed') return

  const { data: settings } = await admin
    .from('settings')
    .select('loyalty_enabled, loyalty_earn_rate_retail, loyalty_referral_bonus')
    .eq('tenant_id', args.tenantId)
    .maybeSingle()
  if (!settings?.loyalty_enabled) return

  await recordEarnSale({
    admin,
    tenantId: args.tenantId,
    customerId: sale.customer_id,
    saleId: args.saleId,
    subtotal: Number(sale.subtotal),
    rate: Number(settings.loyalty_earn_rate_retail),
  })
  await maybeCreditReferral({
    admin,
    tenantId: args.tenantId,
    customerId: sale.customer_id,
    bonusPoints: settings.loyalty_referral_bonus,
  })
}

/**
 * A piece sold here must stop selling on eBay (PLAN Phase 3, must-not-break).
 * Best effort: an eBay failure never undoes a sale; it is logged and the
 * listing stays visible to staff as still active.
 */
async function endEbayListingsForSale(admin: Admin, tenantId: string, saleId: string): Promise<void> {
  const { data: lines } = await admin
    .from('sale_items')
    .select('inventory_item_id')
    .eq('sale_id', saleId)
    .eq('tenant_id', tenantId)
    .not('inventory_item_id', 'is', null)
  const itemIds = (lines ?? []).map((l) => l.inventory_item_id as string)
  if (itemIds.length === 0) return
  const { data: listings } = await admin
    .from('ebay_listings')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('inventory_item_id', itemIds)
    .in('status', ['active', 'submitting'])
  for (const l of listings ?? []) {
    try {
      await endListing({ tenantId, listingId: l.id, reason: 'NOT_AVAILABLE' })
    } catch (err) {
      console.error('[pos.afterSale] eBay listing not ended', l.id, err)
    }
  }
}
