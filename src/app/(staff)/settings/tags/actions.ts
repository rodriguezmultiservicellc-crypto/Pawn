'use server'

/**
 * /settings/tags — tag templates (patches/0074) and the cost-code word.
 *
 * Owner-tier only (requireOwner: owner, or chain_admin at the parent). The
 * writes use the user's own client, so RLS label_templates_owner_write and
 * settings_write enforce the same rule a second time. Only async functions
 * are exported (a 'use server' module may export nothing else).
 */

import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireOwner } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { checkCostCodeWord } from '@/lib/labels/cost-code'
import { FIELDS_BY_KIND, tagTemplateInputSchema, type TagTemplateInput } from '@/lib/labels/templates'

type Result = { ok: true; id?: string } | { ok: false; error: string }

async function ownerCtx() {
  const ctx = await getCtx()
  if (!ctx?.tenantId) return null
  const { supabase, userId } = await requireOwner(ctx.tenantId)
  return { supabase, userId, tenantId: ctx.tenantId }
}

export async function saveTagTemplateAction(id: string | null, input: TagTemplateInput): Promise<Result> {
  const c = await ownerCtx()
  if (!c) return { ok: false, error: 'saveFailed' }

  const parsed = tagTemplateInputSchema.safeParse(input)
  if (!parsed.success) {
    const wings = parsed.error.issues.some((i) => i.message === 'tag_wings_too_small')
    return { ok: false, error: wings ? 'tag_wings_too_small' : 'invalid' }
  }
  const v = parsed.data
  // Keep only the fields this kind can print (collateral never shows price).
  const fields = Object.fromEntries(FIELDS_BY_KIND[v.kind].map((f) => [f, v.fields[f] === true]))
  const row = {
    tenant_id: c.tenantId,
    name: v.name,
    kind: v.kind,
    width_in: v.width_in,
    height_in: v.height_in,
    layout: v.layout,
    gap_in: v.layout === 'split' ? v.gap_in : 0,
    dpi: v.dpi,
    barcode_payload: v.barcode_payload,
    fields,
    is_default: v.is_default,
  }

  // One default per kind (unique index): clear the old one first.
  if (v.is_default) {
    let clear = c.supabase
      .from('label_templates')
      .update({ is_default: false })
      .eq('tenant_id', c.tenantId)
      .eq('kind', v.kind)
      .eq('is_default', true)
      .is('deleted_at', null)
    if (id) clear = clear.neq('id', id)
    const { error } = await clear
    if (error) return { ok: false, error: 'saveFailed' }
  }

  const res = id
    ? await c.supabase.from('label_templates').update(row).eq('id', id).eq('tenant_id', c.tenantId).is('deleted_at', null).select('id').maybeSingle()
    : await c.supabase.from('label_templates').insert({ ...row, created_by: c.userId }).select('id').maybeSingle()
  if (res.error || !res.data) {
    console.error('[settings.tags] save failed', res.error?.message)
    return { ok: false, error: 'saveFailed' }
  }

  await logAudit({
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'tag_template_save',
    tableName: 'label_templates',
    recordId: res.data.id,
    changes: { created: !id, ...row },
  })
  revalidatePath('/settings/tags')
  return { ok: true, id: res.data.id }
}

export async function deleteTagTemplateAction(id: string): Promise<Result> {
  const c = await ownerCtx()
  if (!c) return { ok: false, error: 'saveFailed' }
  // Soft delete; a deleted default simply stops being the default.
  const { data, error } = await c.supabase
    .from('label_templates')
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq('id', id)
    .eq('tenant_id', c.tenantId)
    .is('deleted_at', null)
    .select('id, name, kind')
    .maybeSingle()
  if (error || !data) return { ok: false, error: 'saveFailed' }
  await logAudit({
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'tag_template_delete',
    tableName: 'label_templates',
    recordId: id,
    changes: { name: data.name, kind: data.kind },
  })
  revalidatePath('/settings/tags')
  return { ok: true }
}

/** Empty string turns the cost code off. */
export async function saveTagCostCodeAction(raw: string): Promise<Result> {
  const c = await ownerCtx()
  if (!c) return { ok: false, error: 'saveFailed' }
  let word: string | null = null
  if (raw.trim() !== '') {
    const check = checkCostCodeWord(raw)
    if (!check.ok) return { ok: false, error: check.error }
    word = check.word
  }
  const { error } = await c.supabase.from('settings').update({ tag_cost_code: word }).eq('tenant_id', c.tenantId)
  if (error) return { ok: false, error: 'saveFailed' }
  // The word itself is a (weak) secret: audit that it changed, not its value.
  await logAudit({
    tenantId: c.tenantId,
    userId: c.userId,
    action: 'tag_cost_code_set',
    tableName: 'settings',
    recordId: c.tenantId,
    changes: { enabled: word !== null },
  })
  revalidatePath('/settings/tags')
  return { ok: true }
}
