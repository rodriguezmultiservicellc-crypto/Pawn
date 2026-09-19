'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { storeCreditAdjustSchema } from '@/lib/validations/store-credit'
import { adjustManual, isStoreCreditEnabled } from '@/lib/store-credit/events'
import { r4 } from '@/lib/store-credit/math'

/**
 * Manual store-credit moves from the customer detail panel.
 *
 * Owner / manager / chain_admin only. Handing out or taking back money is
 * not a clerk-level action, and a pawn_clerk who could credit an account
 * could credit their own.
 */
const ADJUST_ROLES = ['owner', 'manager', 'chain_admin'] as const

export type AdjustStoreCreditState = {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
  newBalance?: number
}

export async function adjustStoreCreditAction(
  _prev: AdjustStoreCreditState,
  formData: FormData,
): Promise<AdjustStoreCreditState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const parsed = storeCreditAdjustSchema.safeParse({
    customer_id: formData.get('customer_id'),
    direction: formData.get('direction'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message
    }
    return { error: 'validation_failed', fieldErrors }
  }
  const v = parsed.data

  // Guard FIRST, admin client SECOND (Rule 10).
  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    ADJUST_ROLES,
  )

  // The customer must be in THIS tenant — read through the user-scoped
  // client so RLS backs up the explicit filter.
  const { data: customer } = await supabase
    .from('customers')
    .select('id, store_credit_balance')
    .eq('id', v.customer_id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { error: 'customer_not_found' }

  const admin = createAdminClient()
  if (!(await isStoreCreditEnabled(admin, ctx.tenantId))) {
    return { error: 'store_credit_disabled' }
  }

  const delta = v.direction === 'add' ? r4(v.amount) : r4(-v.amount)

  const result = await adjustManual({
    admin,
    tenantId: ctx.tenantId,
    customerId: v.customer_id,
    amountDelta: delta,
    reason: v.reason,
    performedBy: userId,
  })
  if (result.ok !== true) {
    // The customers CHECK (store_credit_balance >= 0) is what stops a debit
    // larger than the balance — translate it rather than leaking the
    // constraint name to a clerk.
    if (result.ok === false && /store_credit_balance/.test(result.error)) {
      return { error: 'store_credit_insufficient_balance' }
    }
    return { error: 'store_credit_failed' }
  }

  const { data: after } = await admin
    .from('customers')
    .select('store_credit_balance')
    .eq('id', v.customer_id)
    .maybeSingle()

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'store_credit_adjust',
    tableName: 'store_credit_events',
    recordId: result.id,
    changes: {
      customer_id: v.customer_id,
      direction: v.direction,
      amount: v.amount,
      reason: v.reason,
      balance_before: Number(customer.store_credit_balance),
      balance_after: Number(after?.store_credit_balance ?? 0),
    },
  })

  revalidatePath(`/customers/${v.customer_id}`)
  return { ok: true, newBalance: Number(after?.store_credit_balance ?? 0) }
}
