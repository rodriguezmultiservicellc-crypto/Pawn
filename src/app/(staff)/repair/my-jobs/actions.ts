'use server'

/**
 * My jobs — the technician's weights on each item (patches/0132).
 *
 *   confirmReceiptAction  weight + karat as the tech reads them when taking
 *                         the piece to the bench. Required before any time
 *                         goes on the job (start / claim refuse without it).
 *   finishJobAction       the weight when the work is done, then the job goes
 *                         to QA through sendToQaAction (one path for that).
 *
 * Only the technician on the job, or an owner / manager, may write them.
 * Differences from intake are recorded in a note on the ticket, never refused.
 */

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  allReceived,
  cleanKarat,
  fmtGramsChange,
  gramsChange,
  parseGrams,
  sameKarat,
} from '@/lib/repair/item-weights'
import { sendToQaAction } from '../[id]/actions'
import type { TenantRole } from '@/types/database-aliases'

type Result = { ok?: boolean; error?: string }

const TECH_ROLES: TenantRole[] = ['owner', 'manager', 'repair_tech', 'chain_admin']
const LEAD_ROLES = new Set<TenantRole>(['owner', 'manager', 'chain_admin'])
const CLOSED = new Set(['picked_up', 'abandoned', 'voided'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The ticket, its live items, and the caller — after the role check. */
async function loadJob(ticketId: string) {
  if (!UUID.test(ticketId)) return { error: 'validation_failed' as const }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')
  const { supabase, userId } = await requireRoleInTenant(ctx.tenantId, TECH_ROLES)
  const tenantId = ctx.tenantId
  const { data: ticket } = await supabase
    .from('repair_tickets')
    .select('id, status, is_locked, assigned_to')
    .eq('id', ticketId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ticket) return { error: 'not_found' as const }
  if (ticket.is_locked || CLOSED.has(ticket.status)) return { error: 'ticket_closed' as const }
  // The technician on the job, or a lead.
  if (ticket.assigned_to !== userId && !(ctx.tenantRole && LEAD_ROLES.has(ctx.tenantRole))) {
    return { error: 'notAuthorized' as const }
  }
  const { data: items } = await supabase
    .from('repair_ticket_line_items')
    .select('id, line_index, title, karat, weight_grams, received_weight_grams, received_karat, received_at, final_weighed_at')
    .eq('tenant_id', tenantId)
    .eq('ticket_id', ticket.id)
    .is('deleted_at', null)
    .order('line_index', { ascending: true })
  return { ticket, items: items ?? [], supabase, userId, tenantId }
}

/** Reads item_<n>_id + the named fields for every item of the ticket. */
function readItems(formData: FormData, ids: readonly string[], field: string): Map<string, string> {
  const out = new Map<string, string>()
  const count = Number(formData.get('item_count') ?? 0)
  for (let i = 0; i < count && i < 50; i++) {
    const id = String(formData.get(`item_${i}_id`) ?? '')
    if (ids.includes(id)) out.set(id, String(formData.get(`item_${i}_${field}`) ?? ''))
  }
  return out
}

export async function confirmReceiptAction(formData: FormData): Promise<Result> {
  const job = await loadJob(String(formData.get('ticket_id') ?? ''))
  if ('error' in job) return { error: job.error }
  const { ticket, items, supabase, userId, tenantId } = job
  if (items.length === 0) return { error: 'no_items' }

  const ids = items.map((i) => i.id)
  const weights = readItems(formData, ids, 'weight')
  const karats = readItems(formData, ids, 'karat')
  const now = new Date().toISOString()
  const diffs: string[] = []

  for (const it of items) {
    const grams = parseGrams(weights.get(it.id))
    if (grams == null) return { error: 'weight_required' }
    const karat = cleanKarat(karats.get(it.id))
    const { error } = await supabase
      .from('repair_ticket_line_items')
      .update({ received_weight_grams: grams, received_karat: karat, received_at: now, received_by: userId })
      .eq('id', it.id)
      .eq('tenant_id', tenantId)
    if (error) return { error: error.message }

    const intake = it.weight_grams == null ? null : Number(it.weight_grams)
    const d = gramsChange(intake, grams)
    const label = `#${it.line_index} ${it.title}`
    if (d != null) diffs.push(`${label}: intake ${intake}g, received ${grams}g (${fmtGramsChange(d)})`)
    if (!sameKarat(it.karat, karat)) diffs.push(`${label}: intake ${it.karat ?? '—'}, received ${karat ?? '—'}`)
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: diffs.length
      ? `Received at the bench — differs from intake: ${diffs.join('; ')}`
      : 'Received at the bench: weight and karat match intake.',
    performed_by: userId,
  })
  await logAudit({
    tenantId,
    userId,
    action: 'repair_item_received',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      items: items.map((it) => ({
        id: it.id,
        weight: parseGrams(weights.get(it.id)),
        karat: cleanKarat(karats.get(it.id)),
      })),
      differences: diffs,
    },
  })

  revalidatePath('/repair/my-jobs')
  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

export async function finishJobAction(formData: FormData): Promise<Result> {
  const job = await loadJob(String(formData.get('ticket_id') ?? ''))
  if ('error' in job) return { error: job.error }
  const { ticket, items, supabase, userId, tenantId } = job
  if (ticket.status !== 'in_progress') return { error: 'illegalTransition' }
  if (!allReceived(items)) return { error: 'receipt_required' }

  const ids = items.map((i) => i.id)
  const weights = readItems(formData, ids, 'final_weight')
  const parsed = items.map((it) => ({ it, grams: parseGrams(weights.get(it.id)) }))
  if (parsed.some((p) => p.grams == null)) return { error: 'weight_required' }

  const now = new Date().toISOString()
  const changes: string[] = []
  for (const { it, grams } of parsed) {
    const { error } = await supabase
      .from('repair_ticket_line_items')
      .update({ final_weight_grams: grams, final_weighed_at: now, final_weighed_by: userId })
      .eq('id', it.id)
      .eq('tenant_id', tenantId)
    if (error) return { error: error.message }
    const before = it.received_weight_grams == null ? null : Number(it.received_weight_grams)
    const d = gramsChange(before, grams)
    changes.push(`#${it.line_index} ${it.title}: ${grams}g${d != null ? ` (${fmtGramsChange(d)})` : ''}`)
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: `Finished — ending weight: ${changes.join('; ')}`,
    performed_by: userId,
  })
  await logAudit({
    tenantId,
    userId,
    action: 'repair_item_finished',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { items: parsed.map(({ it, grams }) => ({ id: it.id, final_weight: grams })) },
  })

  // Off to QA — the one path that moves a job there (stops the timer too).
  const fd = new FormData()
  fd.set('ticket_id', ticket.id)
  const qa = await sendToQaAction(fd)
  if (qa.error) return { error: qa.error }

  revalidatePath('/repair/my-jobs')
  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}
