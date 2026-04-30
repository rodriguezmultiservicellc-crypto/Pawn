'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import {
  canTransition,
  shouldOpenTimerOnEnter,
  shouldStopTimerOnLeave,
} from '@/lib/repair/workflow'
import type { AuditAction } from '@/lib/audit'
import type {
  RepairEventType,
  RepairStatus,
  RepairTicketUpdate,
  TenantRole,
} from '@/types/database-aliases'

export type MoveResult = { ok?: boolean; error?: string }

const MANAGER_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'chain_admin',
]

const moveSchema = z.object({
  ticket_id: z.string().uuid(),
  to_status: z.enum([
    'assigned',
    'in_progress',
    'needs_parts',
    'tech_qa',
    'ready',
  ]),
})

/**
 * Map a (from, to) status pair to the matching event_type that the rest of
 * the codebase already records. Mirrors the per-action choices in
 * /repair/[id]/actions.ts (parts_needed for needs_parts, qa_started for
 * tech_qa, etc.) so the timeline keeps a uniform vocabulary regardless
 * of whether the move came from a button or a drag.
 *
 * Returns null when the pair is illegal — caller already gates with
 * canTransition() but this stays defensive.
 */
function moveDescriptor(
  from: RepairStatus,
  to: RepairStatus,
): { event: RepairEventType; audit: AuditAction } | null {
  if (from === 'assigned' && to === 'in_progress')
    return { event: 'claimed_by_tech', audit: 'claim_ticket' }
  if (from === 'in_progress' && to === 'needs_parts')
    return { event: 'parts_needed', audit: 'mark_needs_parts' }
  if (from === 'in_progress' && to === 'tech_qa')
    return { event: 'qa_started', audit: 'send_to_qa' }
  if (from === 'in_progress' && to === 'ready')
    return { event: 'completed', audit: 'mark_complete' }
  if (from === 'needs_parts' && to === 'in_progress')
    return { event: 'parts_received', audit: 'parts_received' }
  if (from === 'tech_qa' && to === 'ready')
    return { event: 'qa_completed', audit: 'approve_qa' }
  if (from === 'tech_qa' && to === 'in_progress')
    return { event: 'qa_returned', audit: 'return_from_qa' }
  return null
}

/**
 * Drag-and-drop move on the manager kanban. Manager-only.
 *
 * Validates the transition through the same workflow state machine the
 * detail-page actions use, runs auto-timer hooks (open on entering
 * in_progress with an assigned tech; stop on leaving in_progress), writes
 * a repair_ticket_events row with the correct event_type, and audit-logs
 * the move.
 *
 * Side effects mirror the equivalent buttoned actions so the timeline /
 * audit_log stay consistent across both surfaces.
 */
export async function moveTicketStatusAction(
  formData: FormData,
): Promise<MoveResult> {
  const parsed = moveSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    to_status: formData.get('to_status'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const { ticket_id, to_status } = parsed.data

  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: ticket } = await ctx.supabase
    .from('repair_tickets')
    .select(
      'id, tenant_id, status, assigned_to, completed_at',
    )
    .eq('id', ticket_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ticket) return { error: 'not_found' }

  const { supabase, userId } = await requireRoleInTenant(
    ticket.tenant_id,
    MANAGER_ROLES,
  )

  const fromStatus = ticket.status as RepairStatus
  if (fromStatus === to_status) return { ok: true }

  if (!canTransition(fromStatus, to_status)) {
    return { error: 'illegalTransition' }
  }

  const desc = moveDescriptor(fromStatus, to_status)
  if (!desc) return { error: 'illegalTransition' }

  const patch: RepairTicketUpdate = {
    status: to_status,
    updated_by: userId,
  }
  // claim adds a claimed_at stamp the same way claimTicketAction does.
  if (desc.event === 'claimed_by_tech' && ticket.assigned_to) {
    patch.claimed_at = new Date().toISOString()
  }
  // Mark complete on transitions ending in 'ready' so the dashboard's
  // "completed last 14d" rollup picks it up — same field the buttoned
  // markCompleteAction / approveQaAction already stamp.
  if (to_status === 'ready' && ticket.completed_at == null) {
    patch.completed_at = new Date().toISOString()
  }

  const { error: upErr } = await supabase
    .from('repair_tickets')
    .update(patch)
    .eq('id', ticket.id)
    .eq('tenant_id', ticket.tenant_id)
  if (upErr) return { error: upErr.message }

  // Auto-timer: stop running timers on leaving in_progress; open one on
  // entering in_progress IF the ticket has an assigned tech.
  if (shouldStopTimerOnLeave(fromStatus)) {
    await supabase
      .from('repair_time_logs')
      .update({ stopped_at: new Date().toISOString() })
      .eq('ticket_id', ticket.id)
      .eq('tenant_id', ticket.tenant_id)
      .is('stopped_at', null)
  }
  if (
    shouldOpenTimerOnEnter(to_status) &&
    ticket.assigned_to
  ) {
    const { data: openTimer } = await supabase
      .from('repair_time_logs')
      .select('id')
      .eq('ticket_id', ticket.id)
      .eq('technician_id', ticket.assigned_to)
      .is('stopped_at', null)
      .maybeSingle()
    if (!openTimer) {
      await supabase.from('repair_time_logs').insert({
        ticket_id: ticket.id,
        tenant_id: ticket.tenant_id,
        technician_id: ticket.assigned_to,
        started_at: new Date().toISOString(),
        notes: `auto: ${desc.event}`,
      })
    }
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: ticket.tenant_id,
    event_type: desc.event,
    new_status: to_status,
    notes: 'Moved via board',
    performed_by: userId,
  })

  await logAudit({
    tenantId: ticket.tenant_id,
    userId,
    action: desc.audit,
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      from_status: fromStatus,
      to_status,
      via: 'board',
    },
  })

  revalidatePath('/repair/board')
  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}
