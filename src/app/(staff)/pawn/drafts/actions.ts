'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { buildDraftPayload } from '@/lib/pawn/intake-form'

const DRAFT_ROLES = ['owner', 'manager', 'pawn_clerk', 'chain_admin'] as const

/**
 * Save (or update) a pawn-intake draft. The ONLY hard requirement is a
 * customer — everything else is staged partial in loan_drafts.payload and
 * validated later when the operator finalizes via createLoanAction. Drafts
 * never touch the regulated loans table and never burn a ticket number.
 *
 * loan_drafts isn't in the generated Database type until the next
 * `npm run db:types` after patches/0045, so we reach it through a
 * generically-typed client. RLS still enforces tenant + staff isolation.
 */
export async function saveLoanDraft(formData: FormData): Promise<void> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_pawn')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_pawn) redirect('/dashboard')

  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [
    ...DRAFT_ROLES,
  ])
  const tenantId = ctx.tenantId

  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) redirect('/pawn/new')

  // Defense in depth: the customer must belong to this tenant.
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) redirect('/pawn/new')

  const payload = buildDraftPayload(formData)
  const draftId = String(formData.get('draft_id') ?? '').trim()
  const db = supabase as unknown as SupabaseClient

  if (draftId) {
    await db
      .from('loan_drafts')
      .update({ customer_id: customerId, payload, updated_by: userId })
      .eq('id', draftId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
    await logAudit({
      tenantId,
      userId,
      action: 'update',
      tableName: 'loan_drafts',
      recordId: draftId,
      changes: { customer_id: customerId, item_count: payload.collateral.length },
    })
  } else {
    const { data: inserted } = await db
      .from('loan_drafts')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        payload,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .single()
    const newId = (inserted as { id: string } | null)?.id
    if (newId) {
      await logAudit({
        tenantId,
        userId,
        action: 'create',
        tableName: 'loan_drafts',
        recordId: newId,
        changes: {
          customer_id: customerId,
          item_count: payload.collateral.length,
        },
      })
    }
  }

  revalidatePath('/pawn/drafts')
  redirect('/pawn/drafts')
}

/** Soft-delete (discard) a pawn-intake draft. */
export async function deleteLoanDraft(formData: FormData): Promise<void> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, [
    ...DRAFT_ROLES,
  ])
  const tenantId = ctx.tenantId

  const draftId = String(formData.get('draft_id') ?? '').trim()
  if (!draftId) redirect('/pawn/drafts')

  const db = supabase as unknown as SupabaseClient
  await db
    .from('loan_drafts')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)

  await logAudit({
    tenantId,
    userId,
    action: 'soft_delete',
    tableName: 'loan_drafts',
    recordId: draftId,
    changes: { discarded: true },
  })

  revalidatePath('/pawn/drafts')
  redirect('/pawn/drafts')
}
