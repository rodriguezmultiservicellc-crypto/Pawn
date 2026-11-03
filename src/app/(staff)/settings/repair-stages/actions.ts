'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import type { RepairStatus } from '@/types/database-aliases'

/**
 * /settings/repair-stages — per-service-type customer-facing stages
 * (patches/0061) and the "text when ready" switch.
 *
 * Owner / chain_admin / manager only. Writes go through the admin client
 * so the reorder can run as a controlled two-pass update (the UNIQUE
 * (tenant, service_type, sort_order) index would otherwise bounce a swap
 * mid-way); RLS on repair_stages carries the same role set.
 */

const ROLES = ['owner', 'chain_admin', 'manager'] as const

// The service-type / status lists themselves live in lib/repair/stages.ts
// (a 'use server' module may only export async functions).
const serviceTypeSchema = z.enum([
  'repair',
  'stone_setting',
  'sizing',
  'restring',
  'plating',
  'engraving',
  'custom',
])

const statusSchema = z.enum([
  'intake',
  'quoted',
  'awaiting_approval',
  'assigned',
  'in_progress',
  'needs_parts',
  'tech_qa',
  'ready',
  'picked_up',
  'abandoned',
])

const rowSchema = z.object({
  id: z.string().uuid().nullable(),
  name_en: z.string().trim().min(1, 'name_required').max(60),
  name_es: z.string().trim().min(1, 'name_required').max(60),
  percent: z.coerce.number().int().min(0, 'percent_range').max(100, 'percent_range'),
  maps_to_statuses: z.array(statusSchema).default([]),
  is_active: z.boolean().default(true),
})

const rowsSchema = z.array(rowSchema).min(1, 'min_one').max(30)

export type StageRowInput = z.infer<typeof rowSchema>

export type SaveStagesState = {
  ok?: boolean
  /** Translated through t.settingsRepairStages.errors[code] when it matches. */
  error?: string
  /** Row index → error code, for highlighting. */
  rowErrors?: Record<number, string>
}

export async function saveRepairStagesAction(
  _prev: SaveStagesState,
  formData: FormData,
): Promise<SaveStagesState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])
  const tenantId = ctx.tenantId

  const typeParsed = serviceTypeSchema.safeParse(formData.get('service_type'))
  if (!typeParsed.success) return { error: 'invalid' }
  const serviceType = typeParsed.data

  let rawRows: unknown
  try {
    rawRows = JSON.parse(String(formData.get('rows') ?? '[]'))
  } catch {
    return { error: 'invalid' }
  }
  const parsed = rowsSchema.safeParse(rawRows)
  if (!parsed.success) {
    const rowErrors: Record<number, string> = {}
    let topError = 'invalid'
    for (const issue of parsed.error.issues) {
      const idx = typeof issue.path[0] === 'number' ? issue.path[0] : null
      if (idx == null) {
        topError = issue.message === 'min_one' ? 'min_one' : 'invalid'
      } else {
        rowErrors[idx] = issue.message === 'name_required' || issue.message === 'percent_range'
          ? issue.message
          : 'invalid'
      }
    }
    return { error: topError, rowErrors }
  }
  const rows = parsed.data

  const admin = createAdminClient()

  const { data: existingRows, error: readErr } = await admin
    .from('repair_stages')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('service_type', serviceType)
  if (readErr) return { error: readErr.message }
  const existingIds = new Set((existingRows ?? []).map((r) => r.id))
  const keepIds = new Set(rows.map((r) => r.id).filter((id): id is string => !!id))

  // Rows the operator removed. The FK (ON DELETE SET NULL) clears any
  // ticket pointing at them; they are re-pointed below.
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await admin
      .from('repair_stages')
      .delete()
      .eq('tenant_id', tenantId)
      .in('id', toDelete)
    if (error) return { error: error.message }
  }

  // Pass 1 — park every surviving row on a negative sort_order so the
  // final renumbering cannot collide with a neighbour's old position.
  let i = 0
  for (const r of rows) {
    i += 1
    if (!r.id || !existingIds.has(r.id)) continue
    const { error } = await admin
      .from('repair_stages')
      .update({ sort_order: -i })
      .eq('id', r.id)
      .eq('tenant_id', tenantId)
    if (error) return { error: error.message }
  }

  // Pass 2 — final order + fields; insert the new ones.
  const finalRows: Array<{ id: string; maps_to_statuses: RepairStatus[]; is_active: boolean; sort_order: number }> = []
  i = 0
  for (const r of rows) {
    i += 1
    const sort_order = i * 10
    const patch = {
      name_en: r.name_en,
      name_es: r.name_es,
      percent: r.percent,
      maps_to_statuses: r.maps_to_statuses,
      is_active: r.is_active,
      sort_order,
      updated_by: userId,
    }
    if (r.id && existingIds.has(r.id)) {
      const { error } = await admin
        .from('repair_stages')
        .update(patch)
        .eq('id', r.id)
        .eq('tenant_id', tenantId)
      if (error) return { error: error.message }
      finalRows.push({ id: r.id, maps_to_statuses: r.maps_to_statuses, is_active: r.is_active, sort_order })
    } else {
      const { data, error } = await admin
        .from('repair_stages')
        .insert({
          tenant_id: tenantId,
          service_type: serviceType,
          ...patch,
          created_by: userId,
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      finalRows.push({ id: data.id, maps_to_statuses: r.maps_to_statuses, is_active: r.is_active, sort_order })
    }
  }

  // Re-point open tickets whose stage vanished (or never had one): first
  // active stage mapping the ticket's status — the same rule the DB
  // trigger applies when a ticket has no usable current stage.
  const { data: orphans } = await admin
    .from('repair_tickets')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('service_type', serviceType)
    .is('deleted_at', null)
    .is('public_stage_id', null)
  for (const t of orphans ?? []) {
    const target = finalRows
      .filter((s) => s.is_active && s.maps_to_statuses.includes(t.status as RepairStatus))
      .sort((a, b) => a.sort_order - b.sort_order)[0]
    if (!target) continue
    await admin
      .from('repair_tickets')
      .update({ public_stage_id: target.id, public_stage_updated_at: new Date().toISOString() })
      .eq('id', t.id)
      .eq('tenant_id', tenantId)
  }

  await logAudit({
    tenantId,
    userId,
    action: 'repair_stages_update',
    tableName: 'repair_stages',
    recordId: serviceType,
    changes: {
      service_type: serviceType,
      stages: rows.map((r) => ({ name_en: r.name_en, percent: r.percent, maps: r.maps_to_statuses, active: r.is_active })),
      deleted: toDelete.length,
    },
  })

  revalidatePath('/settings/repair-stages')
  revalidatePath('/repair/board')
  revalidatePath('/repair')
  return { ok: true }
}

export async function resetRepairStagesAction(
  _prev: SaveStagesState,
  formData: FormData,
): Promise<SaveStagesState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const typeParsed = serviceTypeSchema.safeParse(formData.get('service_type'))
  if (!typeParsed.success) return { error: 'invalid' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('seed_default_repair_stages', {
    p_tenant_id: ctx.tenantId,
    p_service_type: typeParsed.data,
    p_reset: true,
  })
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'repair_stages_reset',
    tableName: 'repair_stages',
    recordId: typeParsed.data,
    changes: { service_type: typeParsed.data },
  })

  revalidatePath('/settings/repair-stages')
  revalidatePath('/repair/board')
  revalidatePath('/repair')
  return { ok: true }
}

export type SaveNotifyState = { ok?: boolean; error?: string }

export async function saveRepairNotifyAction(
  _prev: SaveNotifyState,
  formData: FormData,
): Promise<SaveNotifyState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { userId } = await requireRoleInTenant(ctx.tenantId, [...ROLES])

  const enabled = formData.get('repair_ready_auto_notify') === 'on'
  const admin = createAdminClient()
  const { error } = await admin
    .from('settings')
    .update({ repair_ready_auto_notify: enabled })
    .eq('tenant_id', ctx.tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: ctx.tenantId,
    userId,
    action: 'repair_notify_setting',
    tableName: 'settings',
    recordId: ctx.tenantId,
    changes: { repair_ready_auto_notify: enabled },
  })

  revalidatePath('/settings/repair-stages')
  return { ok: true }
}
