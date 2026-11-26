import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { buildRepairDraftPayload } from '@/lib/repair/draft-payload'

/**
 * Save (or update) a New repair ticket as a draft (patches/0118) — the only
 * way a repair draft is written. Used by "Continue on another device"; the
 * handoff itself is lib/pawn/draft-handoff with table 'repair_drafts'.
 * Null when the customer is missing or not this shop's. Guard first: the
 * caller passes the client requireRoleInTenant returned.
 */
export async function upsertRepairDraft(args: {
  supabase: unknown
  tenantId: string
  userId: string
  formData: FormData
}): Promise<string | null> {
  // Same generic client the pawn draft helper uses (the payload is JSON).
  const db = args.supabase as SupabaseClient
  const { tenantId, userId, formData } = args
  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) return null
  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return null

  const payload = buildRepairDraftPayload(formData)
  const changes = { customer_id: customerId, item_count: payload.line_items.length }
  const draftId = String(formData.get('draft_id') ?? '').trim()

  if (draftId) {
    const { data: updated } = await db
      .from('repair_drafts')
      .update({ customer_id: customerId, payload, updated_by: userId })
      .eq('id', draftId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (updated) {
      await logAudit({ tenantId, userId, action: 'update', tableName: 'repair_drafts', recordId: draftId, changes })
      return draftId
    }
  }

  const { data: inserted } = await db
    .from('repair_drafts')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      payload,
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .single()
  const newId = (inserted as { id: string } | null)?.id ?? null
  if (newId) {
    await logAudit({ tenantId, userId, action: 'create', tableName: 'repair_drafts', recordId: newId, changes })
  }
  return newId
}
