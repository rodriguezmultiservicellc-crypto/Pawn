'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { upsertRepairDraft } from '@/lib/repair/draft-save'
import { repairDraftScope } from '@/lib/repair/draft-scope'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Save as draft" on New repair ticket (any device). Only a customer is
 * required; the draft goes through upsertRepairDraft, the one way a repair
 * draft is written, and updates the same row when the form already has one
 * (a draft that came by QR code, or one resumed from the list).
 */
export async function saveRepairDraftAction(formData: FormData): Promise<void> {
  const scope = await repairDraftScope()
  if (!scope) redirect('/dashboard')
  const draftId = await upsertRepairDraft({ ...scope, formData })
  if (!draftId) redirect('/repair/new')
  revalidatePath('/repair/drafts')
  redirect('/repair/drafts')
}

/** Discard a repair draft (soft delete). */
export async function deleteRepairDraftAction(formData: FormData): Promise<void> {
  const scope = await repairDraftScope()
  if (!scope) redirect('/dashboard')
  const draftId = String(formData.get('draft_id') ?? '').trim()
  if (!UUID.test(draftId)) redirect('/repair/drafts')

  const db = scope.supabase as unknown as SupabaseClient
  const { data: gone } = await db
    .from('repair_drafts')
    .update({ deleted_at: new Date().toISOString(), updated_by: scope.userId })
    .eq('id', draftId)
    .eq('tenant_id', scope.tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (gone) {
    await logAudit({
      tenantId: scope.tenantId,
      userId: scope.userId,
      action: 'soft_delete',
      tableName: 'repair_drafts',
      recordId: draftId,
      changes: { discarded: true },
    })
  }

  revalidatePath('/repair/drafts')
  redirect('/repair/drafts')
}
