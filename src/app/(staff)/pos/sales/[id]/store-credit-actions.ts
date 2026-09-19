'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import {
  storeCreditRedeemSchema,
  storeCreditUndoSchema,
} from '@/lib/validations/store-credit'
import {
  isStoreCreditEnabled,
  redeemOnSale,
  undoSaleRedemption,
} from '@/lib/store-credit/events'
import { toMoney, validateRedemption } from '@/lib/store-credit/math'

/**
 * Store credit as a POS tender.
 *
 * Separate from addPaymentAction on purpose: a store-credit payment has to
 * debit the customer's balance in the same transaction as the
 * sale_payments row and the paid_total roll-up, which only the
 * store_credit_redeem_on_sale RPC does. Routing it through the generic
 * payment dialog would record a payment against credit nobody was charged
 * for.
 */
const STAFF_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const

export type StoreCreditSaleState = {
  error?: string
  ok?: boolean
  newBalance?: number
}

async function resolveSale(saleId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: sale } = await ctx.supabase
    .from('sales')
    .select('id, tenant_id, status, total, paid_total, customer_id')
    .eq('id', saleId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!sale) redirect('/pos')
  const { userId } = await requireRoleInTenant(sale.tenant_id, STAFF_ROLES)
  return { sale, userId, tenantId: sale.tenant_id }
}

export async function applyStoreCreditAction(
  _prev: StoreCreditSaleState,
  formData: FormData,
): Promise<StoreCreditSaleState> {
  const parsed = storeCreditRedeemSchema.safeParse({
    sale_id: formData.get('sale_id'),
    amount: formData.get('amount'),
  })
  if (!parsed.success) return { error: 'store_credit_invalid_amount' }
  const v = parsed.data

  const { sale, userId, tenantId } = await resolveSale(v.sale_id)
  if (sale.status !== 'open') return { error: 'store_credit_sale_not_open' }
  if (!sale.customer_id) return { error: 'store_credit_no_customer' }

  const admin = createAdminClient()
  if (!(await isStoreCreditEnabled(admin, tenantId))) {
    return { error: 'store_credit_disabled' }
  }

  // Pre-check so the clerk gets a precise, translated message. The RPC
  // repeats every one of these under a row lock — this is a courtesy, not
  // the authority.
  const { data: customer } = await admin
    .from('customers')
    .select('store_credit_balance')
    .eq('id', sale.customer_id)
    .maybeSingle()
  const pre = validateRedemption({
    amount: v.amount,
    balance: toMoney(customer?.store_credit_balance),
    balanceDue: toMoney(sale.total) - toMoney(sale.paid_total),
  })
  if (!pre.ok) return { error: `store_credit_${pre.error}` }

  const result = await redeemOnSale({
    admin,
    tenantId,
    saleId: sale.id,
    amount: pre.amount,
    performedBy: userId,
  })
  if (!result.ok) return { error: result.error }

  await logAudit({
    tenantId,
    userId,
    action: 'store_credit_redeem',
    tableName: 'sale_payments',
    recordId: result.salePaymentId,
    changes: {
      sale_id: sale.id,
      customer_id: sale.customer_id,
      amount: pre.amount,
      store_credit_event_id: result.eventId,
      balance_after: result.newBalance,
    },
  })

  revalidatePath(`/pos/sales/${sale.id}`)
  revalidatePath(`/customers/${sale.customer_id}`)
  revalidatePath('/pos')
  return { ok: true, newBalance: result.newBalance }
}

export async function undoStoreCreditAction(
  _prev: StoreCreditSaleState,
  formData: FormData,
): Promise<StoreCreditSaleState> {
  const parsed = storeCreditUndoSchema.safeParse({
    sale_id: formData.get('sale_id'),
    event_id: formData.get('event_id'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { sale, userId, tenantId } = await resolveSale(v.sale_id)
  if (sale.status !== 'open') return { error: 'store_credit_sale_not_open' }

  const admin = createAdminClient()
  const result = await undoSaleRedemption({
    admin,
    tenantId,
    eventId: v.event_id,
    performedBy: userId,
  })
  if (!result.ok) return { error: result.error }

  await logAudit({
    tenantId,
    userId,
    action: 'store_credit_redeem_undo',
    tableName: 'store_credit_events',
    recordId: result.eventId,
    changes: {
      sale_id: sale.id,
      customer_id: sale.customer_id,
      original_event_id: v.event_id,
      balance_after: result.newBalance,
    },
  })

  revalidatePath(`/pos/sales/${sale.id}`)
  if (sale.customer_id) revalidatePath(`/customers/${sale.customer_id}`)
  return { ok: true, newBalance: result.newBalance }
}
