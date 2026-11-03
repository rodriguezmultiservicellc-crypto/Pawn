'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { logAudit } from '@/lib/audit'
import { dispatchMessage } from '@/lib/comms/dispatch'
import { nextStage, trackingUrl, type RepairStageLite } from '@/lib/repair/stages'
import type { TenantRole } from '@/types/database-aliases'

/**
 * Customer tracking link + customer-facing stage — server actions shared
 * by the ticket detail page and the work-order board (patches/0061).
 *
 * The stage POINTER is what these move; the stage ↔ workflow-status
 * coherence is the database trigger's job, so advancing a sub-stage here
 * never fights a status change made elsewhere.
 */

export type StageActionResult = {
  ok?: boolean
  /** Translated through t.repair.tracking.errors[code] on the client. */
  error?: string
  /** New absolute link after regenerate. */
  link?: string | null
}

const STAFF_REPAIR_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'chain_admin',
  'pawn_clerk',
  'repair_tech',
]

const ticketIdSchema = z.string().uuid()

async function resolveTicket(ticketIdRaw: unknown) {
  const parsed = ticketIdSchema.safeParse(ticketIdRaw)
  if (!parsed.success) return null
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  const { data: ticket } = await ctx.supabase
    .from('repair_tickets')
    .select(
      'id, tenant_id, customer_id, ticket_number, service_type, status, public_token, public_stage_id',
    )
    .eq('id', parsed.data)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ticket) return null

  const { supabase, userId } = await requireRoleInTenant(
    ticket.tenant_id,
    STAFF_REPAIR_ROLES,
  )
  return { ticket, supabase, userId, tenantId: ticket.tenant_id }
}

function revalidateTicket(ticketId: string) {
  revalidatePath(`/repair/${ticketId}`)
  revalidatePath('/repair/board')
  revalidatePath('/repair')
}

/** 32 hex chars — same shape the DB default produces (one UUID, no dashes). */
function newPublicToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// ── Stage ─────────────────────────────────────────────────────────────────

/**
 * Move the customer-facing stage. `stage_id` is a stage uuid or the
 * literal 'next'. Any pawn/repair staff role may advance — this is the
 * one-tap "Next stage" on the board.
 */
export async function setPublicStageAction(
  formData: FormData,
): Promise<StageActionResult> {
  const scope = await resolveTicket(formData.get('ticket_id'))
  if (!scope) return { error: 'not_found' }
  const { ticket, supabase, userId, tenantId } = scope

  const { data: stageRows } = await supabase
    .from('repair_stages')
    .select('id, name_en, name_es, percent, sort_order')
    .eq('tenant_id', tenantId)
    .eq('service_type', ticket.service_type)
    .eq('is_active', true)
    .order('sort_order')
  const stages = (stageRows ?? []) as RepairStageLite[]
  if (stages.length === 0) return { error: 'no_stages' }

  const want = String(formData.get('stage_id') ?? '')
  let target: RepairStageLite | null
  if (want === 'next') {
    target = nextStage(stages, ticket.public_stage_id)
    if (!target) return { error: 'last_stage' }
  } else {
    target = stages.find((s) => s.id === want) ?? null
    if (!target) return { error: 'no_stages' }
  }
  if (target.id === ticket.public_stage_id) return { ok: true }

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      public_stage_id: target.id,
      public_stage_updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: `Stage → ${target.name_en} / ${target.name_es}`,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'repair_stage_set',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      from_stage_id: ticket.public_stage_id,
      to_stage_id: target.id,
      to_stage: target.name_en,
      via: want === 'next' ? 'next' : 'pick',
    },
  })

  revalidateTicket(ticket.id)
  return { ok: true }
}

// ── Link lifecycle ────────────────────────────────────────────────────────

export async function regenerateTrackingLinkAction(
  formData: FormData,
): Promise<StageActionResult> {
  const scope = await resolveTicket(formData.get('ticket_id'))
  if (!scope) return { error: 'not_found' }
  const { ticket, supabase, userId, tenantId } = scope

  const token = newPublicToken()
  const { error } = await supabase
    .from('repair_tickets')
    .update({
      public_token: token,
      public_token_created_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'repair_tracking_link_regenerate',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    // Never log the token itself — the audit log is readable by staff.
    changes: { had_link: ticket.public_token != null },
  })

  revalidateTicket(ticket.id)
  return { ok: true, link: trackingUrl(token) }
}

export async function revokeTrackingLinkAction(
  formData: FormData,
): Promise<StageActionResult> {
  const scope = await resolveTicket(formData.get('ticket_id'))
  if (!scope) return { error: 'not_found' }
  const { ticket, supabase, userId, tenantId } = scope

  const { error } = await supabase
    .from('repair_tickets')
    .update({ public_token: null, updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'repair_tracking_link_revoke',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { had_link: ticket.public_token != null },
  })

  revalidateTicket(ticket.id)
  return { ok: true, link: null }
}

/**
 * "Send by SMS" — the `repair_tracking_link` template through the same
 * dispatcher /settings/communications configures (tenant Twilio creds,
 * customer language, message_log row). Channel is forced to SMS because
 * that is what the button says; WhatsApp-preferring customers still get
 * a text.
 */
export async function sendTrackingLinkAction(
  formData: FormData,
): Promise<StageActionResult> {
  const scope = await resolveTicket(formData.get('ticket_id'))
  if (!scope) return { error: 'not_found' }
  const { ticket, supabase, userId, tenantId } = scope

  const link = trackingUrl(ticket.public_token)
  if (!link) return { error: 'link_revoked' }

  const res = await dispatchMessage({
    tenantId,
    customerId: ticket.customer_id,
    kind: 'repair_tracking_link',
    channelOverride: 'sms',
    vars: {
      ticket_number: ticket.ticket_number ?? '',
      tracking_link: link,
    },
    related: { repairTicketId: ticket.id },
  })
  if (!res.ok) return { error: res.reason }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: 'Tracking link sent by SMS',
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'repair_tracking_link_send',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { channel: res.channel, message_log_id: res.messageLogId },
  })

  revalidateTicket(ticket.id)
  return { ok: true, link }
}
