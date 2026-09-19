'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant, requireStaff } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { screenCustomer } from '@/lib/compliance/ofac/screen'

export type OfacActionResult = { ok?: boolean; error?: string }

const REVIEW_ROLES = ['owner', 'chain_admin', 'manager'] as const

/** Staff: re-run OFAC screening for one customer against the current list. */
export async function screenCustomerNowAction(
  _prev: OfacActionResult,
  formData: FormData,
): Promise<OfacActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const customerId = String(formData.get('customer_id') ?? '')
  if (!z.string().uuid().safeParse(customerId).success) return { error: 'invalid_input' }

  const { userId } = await requireStaff(ctx.tenantId)
  try {
    const row = await screenCustomer({
      admin: createAdminClient(),
      tenantId: ctx.tenantId,
      customerId,
      context: 'manual',
      userId,
    })
    await logAudit({
      tenantId: ctx.tenantId,
      userId,
      action: 'ofac_screen',
      tableName: 'ofac_screenings',
      recordId: row.id,
      changes: { customer_id: customerId, result: row.result, review_status: row.review_status },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'screen_failed' }
  }
  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}

const reviewSchema = z.object({
  screening_id: z.string().uuid(),
  decision: z.enum(['cleared', 'confirmed']),
  note: z.string().trim().min(10).max(2000),
})

/**
 * Owner / chain_admin / manager: resolve a pending potential match.
 * cleared   = false positive (documented reason required).
 * confirmed = true match → the customer is also placed on the banned list.
 */
export async function reviewOfacScreeningAction(
  _prev: OfacActionResult,
  formData: FormData,
): Promise<OfacActionResult> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const parsed = reviewSchema.safeParse({
    screening_id: formData.get('screening_id'),
    decision: formData.get('decision'),
    note: formData.get('note'),
  })
  if (!parsed.success) {
    const noteIssue = parsed.error.issues.some((i) => i.path[0] === 'note')
    return { error: noteIssue ? 'note_required' : 'invalid_input' }
  }
  const v = parsed.data

  const admin = createAdminClient()
  const { data: screening } = await admin
    .from('ofac_screenings')
    .select('id, tenant_id, customer_id, review_status')
    .eq('id', v.screening_id)
    .maybeSingle()
  if (!screening) return { error: 'not_found' }

  // Guard FIRST against the screening's own tenant, admin client SECOND.
  const { userId } = await requireRoleInTenant(screening.tenant_id, [...REVIEW_ROLES])
  if (screening.review_status !== 'pending') return { error: 'not_pending' }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('ofac_screenings')
    .update({
      review_status: v.decision,
      review_note: v.note,
      reviewed_by: userId,
      reviewed_at: now,
    })
    .eq('id', screening.id)
    .eq('review_status', 'pending')
  if (error) return { error: error.message }

  if (v.decision === 'confirmed') {
    await admin
      .from('customers')
      .update({
        is_banned: true,
        banned_reason: `OFAC SDN match confirmed: ${v.note}`.slice(0, 500),
        banned_at: now,
        banned_by: userId,
        updated_by: userId,
      })
      .eq('id', screening.customer_id)
      .eq('tenant_id', screening.tenant_id)
  }

  await logAudit({
    tenantId: screening.tenant_id,
    userId,
    action: 'ofac_review',
    tableName: 'ofac_screenings',
    recordId: screening.id,
    changes: { customer_id: screening.customer_id, decision: v.decision, note: v.note },
  })
  revalidatePath(`/customers/${screening.customer_id}`)
  return { ok: true }
}
