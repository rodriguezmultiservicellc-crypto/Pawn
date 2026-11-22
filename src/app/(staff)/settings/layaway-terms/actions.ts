'use server'

/**
 * /settings/layaway-terms — the shop's saved layaway plans (patches/0093).
 * Owners, chain admins and managers. Writes go through the user's own client
 * so the table's RLS write rule is the second check after the guard.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  LAYAWAY_TERMS_EDIT_ROLES,
  LAYAWAY_TERMS_MAX,
  layawayTermInputSchema,
  type LayawayTermInput,
} from '@/lib/pos/layaway-terms'

type Result =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'limit' | 'not_found' | 'inactive_default' | 'generic' }

async function editor() {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, LAYAWAY_TERMS_EDIT_ROLES)
  return { supabase, userId, tenantId: ctx.tenantId }
}

function done(): Result {
  revalidatePath('/settings/layaway-terms')
  revalidatePath('/pos/sales/new')
  return { ok: true }
}

/** Form fields → table columns (the schema has already turned percents into fractions). */
function columns(input: LayawayTermInput) {
  const parsed = layawayTermInputSchema.safeParse(input)
  if (!parsed.success) return null
  const v = parsed.data
  return {
    name: v.name,
    schedule_kind: v.schedule_kind,
    down_payment_pct: v.down_payment_percent,
    first_payment_days: v.first_payment_days,
    term_days: v.term_days,
    cancellation_fee_pct: v.cancellation_fee_percent,
    is_active: v.is_active,
  }
}

export async function createLayawayTermAction(input: LayawayTermInput): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const row = columns(input)
  if (!row) return { ok: false, error: 'invalid' }

  const { data: existing } = await supabase
    .from('layaway_terms')
    .select('position, is_default')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('position', { ascending: false })
  if ((existing?.length ?? 0) >= LAYAWAY_TERMS_MAX) return { ok: false, error: 'limit' }

  const { data, error } = await supabase
    .from('layaway_terms')
    .insert({
      tenant_id: tenantId,
      ...row,
      // The shop's first usable plan becomes its default.
      is_default: row.is_active && !(existing ?? []).some((r) => r.is_default),
      position: (existing?.[0]?.position ?? -1) + 1,
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    console.error('[layaway-terms] create failed', error?.message)
    return { ok: false, error: 'generic' }
  }
  await logAudit({ tenantId, userId, action: 'create', tableName: 'layaway_terms', recordId: data.id, changes: row })
  return done()
}

export async function updateLayawayTermAction(id: string, input: LayawayTermInput): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const row = columns(input)
  if (!row) return { ok: false, error: 'invalid' }

  const { data, error } = await supabase
    .from('layaway_terms')
    .update({
      ...row,
      // A plan that is switched off cannot stay the default (0093 CHECK).
      ...(row.is_active ? {} : { is_default: false }),
      updated_by: userId,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[layaway-terms] update failed', error.message)
    return { ok: false, error: 'generic' }
  }
  if (!data) return { ok: false, error: 'not_found' }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'layaway_terms', recordId: id, changes: row })
  return done()
}

/** Make one plan the shop's default: the one the New layaway dialog opens on. */
export async function setDefaultLayawayTermAction(id: string): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const { data: target } = await supabase
    .from('layaway_terms')
    .select('id, is_active, is_default')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!target) return { ok: false, error: 'not_found' }
  if (!target.is_active) return { ok: false, error: 'inactive_default' }
  if (target.is_default) return { ok: true }

  // One default per shop (unique index): clear the old one, then set the new.
  const { error: clearError } = await supabase
    .from('layaway_terms')
    .update({ is_default: false, updated_by: userId })
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
  if (clearError) return { ok: false, error: 'generic' }
  const { error } = await supabase
    .from('layaway_terms')
    .update({ is_default: true, updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) {
    console.error('[layaway-terms] set default failed', error.message)
    return { ok: false, error: 'generic' }
  }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'layaway_terms', recordId: id, changes: { is_default: true } })
  return done()
}

/** Swap a plan with its neighbour (-1 = earlier, +1 = later). */
export async function moveLayawayTermAction(id: string, dir: -1 | 1): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const { data: rows } = await supabase
    .from('layaway_terms')
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
      .from('layaway_terms')
      .update({ position: k, updated_by: userId })
      .eq('id', order[k])
      .eq('tenant_id', tenantId)
    if (error) return { ok: false, error: 'generic' }
  }
  await logAudit({ tenantId, userId, action: 'update', tableName: 'layaway_terms', recordId: id, changes: { moved: dir } })
  return done()
}

/**
 * Soft delete. Layaways already opened keep their own dates, down payment
 * and fee — a plan is only a starting point, so removing it changes nothing
 * that was written.
 */
export async function removeLayawayTermAction(id: string): Promise<Result> {
  const { supabase, userId, tenantId } = await editor()
  const { data, error } = await supabase
    .from('layaway_terms')
    .update({ deleted_at: new Date().toISOString(), is_default: false, updated_by: userId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, error: 'generic' }
  await logAudit({ tenantId, userId, action: 'soft_delete', tableName: 'layaway_terms', recordId: id, changes: {} })
  return done()
}
