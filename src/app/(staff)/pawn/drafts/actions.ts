'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { upsertLoanDraft } from '@/lib/pawn/draft-handoff'

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

  // One way to save a draft (lib/pawn/draft-handoff), shared with the QR
  // handoff. No customer, or not this shop's: back to the form.
  const draftId = await upsertLoanDraft({ supabase, tenantId, userId, formData })
  if (!draftId) redirect('/pawn/new')

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
