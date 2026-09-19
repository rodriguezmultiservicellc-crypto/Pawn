'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import {
  consignmentReturnItemSchema,
  consignorCreateSchema,
  consignorPayoutSchema,
  consignorUpdateSchema,
} from '@/lib/validations/consignment'
import {
  isConsignmentEnabled,
  payOutConsignor,
} from '@/lib/consignment/payables'
import type { PaymentMethod } from '@/types/database-aliases'

/**
 * Consignor records carry financial terms — the commission split the shop
 * will hold back from someone else's property. That is a manager decision,
 * not a clerk one, so writing them needs manager+.
 */
const MANAGE_ROLES = ['owner', 'manager', 'chain_admin'] as const
const STAFF_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const

export type ConsignorFormState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
  values?: Record<string, string>
}

function collectFieldErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const k = String(issue.path[0] ?? '')
    if (k && !out[k]) out[k] = issue.message
  }
  return out
}

// ── Create ────────────────────────────────────────────────────────────────

export async function createConsignorAction(
  _prev: ConsignorFormState,
  formData: FormData,
): Promise<ConsignorFormState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const echo: Record<string, string> = {}
  for (const k of [
    'customer_id',
    'business_name',
    'default_commission_pct',
    'default_payout_method',
    'notes',
  ]) {
    const val = formData.get(k)
    echo[k] = typeof val === 'string' ? val : ''
  }

  const parsed = consignorCreateSchema.safeParse({
    customer_id: formData.get('customer_id'),
    business_name: formData.get('business_name'),
    default_commission_pct: formData.get('default_commission_pct'),
    default_payout_method: formData.get('default_payout_method') ?? 'cash',
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    return {
      error: 'validation_failed',
      fieldErrors: collectFieldErrors(parsed.error.issues),
      values: echo,
    }
  }
  const v = parsed.data

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    MANAGE_ROLES,
  )
  if (!(await isConsignmentEnabled(createAdminClient(), ctx.tenantId))) {
    return { error: 'consignment_disabled', values: echo }
  }

  // The customer must be in this tenant — the DB trigger says the same
  // thing, but an untranslated trigger error is not an answer for a clerk.
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', v.customer_id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { error: 'customer_not_found', values: echo }

  const { data, error } = await supabase
    .from('consignors')
    .insert({
      tenant_id: ctx.tenantId,
      customer_id: v.customer_id,
      business_name: v.business_name,
      default_commission_pct: v.default_commission_pct,
      default_payout_method: v.default_payout_method as PaymentMethod,
      notes: v.notes,
      created_by: userId,
      updated_by: userId,
    })
    .select('id, consignor_number')
    .single()

  if (error) {
    // Partial unique index on (tenant_id, customer_id).
    if ((error as { code?: string }).code === '23505') {
      return { error: 'consignor_already_exists', values: echo }
    }
    return { error: error.message, values: echo }
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'consignor_create',
    tableName: 'consignors',
    recordId: data.id,
    changes: {
      consignor_number: data.consignor_number,
      customer_id: v.customer_id,
      default_commission_pct: v.default_commission_pct,
    },
  })

  revalidatePath('/consignors')
  redirect(`/consignors/${data.id}`)
}

// ── Update ────────────────────────────────────────────────────────────────

export async function updateConsignorAction(
  _prev: ConsignorFormState,
  formData: FormData,
): Promise<ConsignorFormState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const parsed = consignorUpdateSchema.safeParse({
    id: formData.get('id'),
    business_name: formData.get('business_name'),
    default_commission_pct: formData.get('default_commission_pct'),
    default_payout_method: formData.get('default_payout_method') ?? 'cash',
    status: formData.get('status') ?? 'active',
    notes: formData.get('notes'),
  })
  if (!parsed.success) {
    return {
      error: 'validation_failed',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    }
  }
  const v = parsed.data

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    MANAGE_ROLES,
  )

  const { error } = await supabase
    .from('consignors')
    .update({
      business_name: v.business_name,
      // Changing the default never re-prices goods already on the floor —
      // each item froze its own rate at intake (patches/0054).
      default_commission_pct: v.default_commission_pct,
      default_payout_method: v.default_payout_method as PaymentMethod,
      status: v.status,
      notes: v.notes,
      updated_by: userId,
    })
    .eq('id', v.id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'consignor_update',
    tableName: 'consignors',
    recordId: v.id,
    changes: {
      default_commission_pct: v.default_commission_pct,
      status: v.status,
    },
  })

  revalidatePath('/consignors')
  revalidatePath(`/consignors/${v.id}`)
  return { ok: true }
}

// ── Payout ────────────────────────────────────────────────────────────────

export type PayoutState = {
  error?: string
  ok?: boolean
  payoutNumber?: string
  amount?: number
}

export async function payOutConsignorAction(
  _prev: PayoutState,
  formData: FormData,
): Promise<PayoutState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const parsed = consignorPayoutSchema.safeParse({
    consignor_id: formData.get('consignor_id'),
    payout_method: formData.get('payout_method') ?? 'cash',
    reference: formData.get('reference'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { userId } = await requireRoleInTenant(ctx.tenantId, MANAGE_ROLES)

  const result = await payOutConsignor({
    admin: createAdminClient(),
    tenantId: ctx.tenantId,
    consignorId: v.consignor_id,
    payoutMethod: v.payout_method as PaymentMethod,
    reference: v.reference,
    performedBy: userId,
  })
  if (!result.ok) return { error: result.error }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'consignment_payout',
    tableName: 'consignment_payouts',
    recordId: result.payoutId,
    changes: {
      consignor_id: v.consignor_id,
      payout_number: result.payoutNumber,
      amount: result.amount,
      payout_method: v.payout_method,
      reference: v.reference,
      settled_rows: result.rowCount,
    },
  })

  revalidatePath(`/consignors/${v.consignor_id}`)
  revalidatePath('/consignors')
  return { ok: true, payoutNumber: result.payoutNumber, amount: result.amount }
}

// ── Hand a consigned item back, unsold ────────────────────────────────────

export type ReturnItemState = { error?: string; ok?: boolean }

/**
 * The agreement ended (or the consignor asked for their goods back) and the
 * item leaves the floor without selling. Nothing is owed either way — no
 * payable is written, because none was ever accrued.
 */
export async function returnConsignedItemAction(
  _prev: ReturnItemState,
  formData: FormData,
): Promise<ReturnItemState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const parsed = consignmentReturnItemSchema.safeParse({
    item_id: formData.get('item_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    STAFF_ROLES,
  )

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id, status, consignor_id, sku')
    .eq('id', v.item_id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!item) return { error: 'item_not_found' }
  if (!item.consignor_id) return { error: 'not_consigned' }
  // A sold item is the buyer's now; handing it back is not this action's
  // job (that is a return), and doing it here would strand the accrual.
  if (item.status !== 'available' && item.status !== 'held') {
    return { error: 'item_not_returnable' }
  }

  const { error } = await supabase
    .from('inventory_items')
    .update({ status: 'returned', updated_by: userId })
    .eq('id', v.item_id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'consignment_item_returned',
    tableName: 'inventory_items',
    recordId: v.item_id,
    changes: {
      sku: item.sku,
      consignor_id: item.consignor_id,
      reason: v.reason,
    },
  })

  revalidatePath(`/consignors/${item.consignor_id}`)
  revalidatePath(`/inventory/${v.item_id}`)
  revalidatePath('/inventory')
  return { ok: true }
}
