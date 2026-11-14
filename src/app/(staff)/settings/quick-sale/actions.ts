'use server'

/**
 * /settings/quick-sale — the shop's POS quick sale buttons (patches/0081).
 * Owners, chain admins and managers. Writes go through the user's own client
 * so the table's RLS write rule is the second check after the guard.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { QUICK_SALE_EDIT_ROLES, QUICK_SALE_MAX, quickSaleInputSchema, type QuickSaleInput } from '@/lib/pos/quick-sale'

type Result = { ok: true } | { ok: false; error: 'invalid' | 'limit' | 'generic' }

async function editor() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, QUICK_SALE_EDIT_ROLES)
  return { supabase, userId, tenantId: ctx.tenantId }
}

function done(): Result {
  revalidatePath('/settings/quick-sale')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}

export async function createQuickSaleAction(input: QuickSaleInput): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const parsed = quickSaleInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }

  const { data: existing } = await supabase
    .from('quick_sale_buttons')
    .select('position')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: false })
  if ((existing?.length ?? 0) >= QUICK_SALE_MAX) return { ok: false, error: 'limit' }

  const { data, error } = await supabase
    .from('quick_sale_buttons')
    .insert({
      tenant_id: tenantId,
      ...parsed.data,
      position: (existing?.[0]?.position ?? -1) + 1,
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    console.error('[quick-sale] create failed', error?.message)
    return { ok: false, error: 'generic' }
  }
  await logAudit({ tenantId, userId, action: 'create', tableName: 'quick_sale_buttons', recordId: data.id, changes: parsed.data })
  return done()
}

export async function updateQuickSaleAction(id: string, input: QuickSaleInput): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const parsed = quickSaleInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { data, error } = await supabase
    .from('quick_sale_buttons')
    .update({ ...parsed.data, updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, error: 'generic' }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'quick_sale_buttons', recordId: id, changes: parsed.data })
  return done()
}

/** Swap a button with its neighbour (-1 = earlier, +1 = later). */
export async function moveQuickSaleAction(id: string, dir: -1 | 1): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const { data: rows } = await supabase
    .from('quick_sale_buttons')
    .select('id, position')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  const list = rows ?? []
  const i = list.findIndex((r) => r.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return { ok: true }

  // Renumber the whole list in its new order; positions may have gaps or ties.
  const order = list.map((r) => r.id)
  ;[order[i], order[j]] = [order[j], order[i]]
  for (let k = 0; k < order.length; k++) {
    const { error } = await supabase
      .from('quick_sale_buttons')
      .update({ position: k, updated_by: userId })
      .eq('id', order[k])
      .eq('tenant_id', tenantId)
    if (error) return { ok: false, error: 'generic' }
  }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'quick_sale_buttons', recordId: id, changes: { moved: dir } })
  return done()
}

/** Soft delete. Past sales keep their line; only the button goes away. */
export async function removeQuickSaleAction(id: string): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const { data, error } = await supabase
    .from('quick_sale_buttons')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, error: 'generic' }
  await logAudit({ tenantId, userId, action: 'soft_delete', tableName: 'quick_sale_buttons', recordId: id, changes: {} })
  return done()
}
