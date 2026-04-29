'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  ALLOWED_REPAIR_PHOTO_MIME_TYPES,
  ALLOWED_REPAIR_SIGNATURE_MIME_TYPES,
  MAX_REPAIR_PHOTO_BYTES,
  MAX_REPAIR_SIGNATURE_BYTES,
  repairAbandonSchema,
  repairAddNoteSchema,
  repairAddPartSchema,
  repairAddPhotoSchema,
  repairAddStoneSchema,
  repairApproveQuoteSchema,
  repairAssignSchema,
  repairCollectDepositSchema,
  repairCompleteSchema,
  repairNeedsPartsSchema,
  repairPartsReceivedSchema,
  repairPickupSchema,
  repairQuoteSchema,
  repairSetCaptionSchema,
  repairStartWorkSchema,
  repairTimeStartSchema,
  repairTimeStopSchema,
  repairTicketUpdateSchema,
  repairVoidSchema,
} from '@/lib/validations/repair'
import {
  REPAIR_PHOTOS_BUCKET,
  deleteFromBucket,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'
import {
  canTransition,
  shouldOpenTimerOnEnter,
  shouldStopTimerOnLeave,
} from '@/lib/repair/workflow'
import { computeBalanceDue, lineTotalCost, r4 } from '@/lib/repair/billing'
import type {
  RepairStatus,
  RepairTicketUpdate,
  RepairTimeLogUpdate,
  TenantRole,
} from '@/types/database-aliases'

export type ActionResult = { error?: string; ok?: boolean }

const STAFF_REPAIR_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'chain_admin',
]

const TECH_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'repair_tech',
  'chain_admin',
]

function pickExt(mime: string | null | undefined, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf('.')
    if (dot >= 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext)) return ext
    }
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  if (mime === 'application/pdf') return 'pdf'
  return 'bin'
}

function newUuid(): string {
  return crypto.randomUUID()
}

async function resolveTicketScope(
  ticketId: string,
  allowed: ReadonlyArray<TenantRole> = STAFF_REPAIR_ROLES,
) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: ticket } = await ctx.supabase
    .from('repair_tickets')
    .select(
      // assigned_to / assigned_at / claimed_at added in 0023; needed for
      // claim authorization + auto-timer flow.
      'id, tenant_id, customer_id, service_type, status, is_locked, quote_amount, deposit_amount, paid_amount, item_description, ticket_number, assigned_to, assigned_at, claimed_at',
    )
    .eq('id', ticketId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ticket) redirect('/repair')
  const { supabase, userId } = await requireRoleInTenant(
    ticket.tenant_id,
    allowed,
  )
  return { ticket, supabase, userId, tenantId: ticket.tenant_id }
}

// ── Auto-timer helpers (used by claim / QA-return / parts-received and
// the in_progress-out transitions). Idempotent: openTimerForTech is a
// no-op if a timer is already running for this tech on this ticket;
// stopRunningTimers is a no-op if no timers are running. ──────────────

type AdminLikeClient = Awaited<ReturnType<typeof requireRoleInTenant>>['supabase']

async function openTimerForTech(args: {
  supabase: AdminLikeClient
  tenantId: string
  ticketId: string
  techUserId: string
  reason: 'claim' | 'parts_received' | 'qa_returned' | 'manual'
}): Promise<void> {
  const { data: existing } = await args.supabase
    .from('repair_time_logs')
    .select('id')
    .eq('ticket_id', args.ticketId)
    .eq('technician_id', args.techUserId)
    .is('stopped_at', null)
    .maybeSingle()
  if (existing) return
  await args.supabase.from('repair_time_logs').insert({
    ticket_id: args.ticketId,
    tenant_id: args.tenantId,
    technician_id: args.techUserId,
    started_at: new Date().toISOString(),
    notes: `auto: ${args.reason}`,
  })
}

async function stopRunningTimers(args: {
  supabase: AdminLikeClient
  tenantId: string
  ticketId: string
  reason: 'needs_parts' | 'qa' | 'ready' | 'voided' | 'abandoned'
}): Promise<void> {
  await args.supabase
    .from('repair_time_logs')
    .update({ stopped_at: new Date().toISOString() })
    .eq('ticket_id', args.ticketId)
    .eq('tenant_id', args.tenantId)
    .is('stopped_at', null)
}

const MANAGER_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'chain_admin',
]

// ── Update basic fields (title / promised / description / notes) ─────────────

export async function updateRepairTicketAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairTicketUpdateSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    title: formData.get('title'),
    item_description: formData.get('item_description'),
    description: formData.get('description'),
    promised_date: formData.get('promised_date'),
    assigned_to: formData.get('assigned_to'),
    notes_internal: formData.get('notes_internal'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.is_locked) return { error: 'customer_locked' }

  const patch: RepairTicketUpdate = { updated_by: userId }
  if (v.title !== undefined) patch.title = v.title
  if (v.item_description !== undefined)
    patch.item_description = v.item_description
  if (v.description !== undefined) patch.description = v.description
  if (v.promised_date !== undefined) patch.promised_date = v.promised_date
  if (v.assigned_to !== undefined) patch.assigned_to = v.assigned_to
  if (v.notes_internal !== undefined) patch.notes_internal = v.notes_internal

  const { error } = await supabase
    .from('repair_tickets')
    .update(patch)
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: patch as Record<string, unknown>,
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Set quote ───────────────────────────────────────────────────────────────

export async function setQuoteAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairQuoteSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    quote_amount: formData.get('quote_amount'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.is_locked) return { error: 'customer_locked' }

  const balance = computeBalanceDue({
    quote: v.quote_amount,
    deposit: ticket.deposit_amount,
  })

  let nextStatus: RepairStatus = ticket.status as RepairStatus
  if (ticket.status === 'intake') {
    if (canTransition(ticket.status as RepairStatus, 'quoted')) {
      nextStatus = 'quoted'
    }
  }

  const { error: upErr } = await supabase
    .from('repair_tickets')
    .update({
      quote_amount: v.quote_amount,
      quote_set_at: new Date().toISOString(),
      balance_due: balance,
      status: nextStatus,
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (upErr) return { error: upErr.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'quote_set',
    amount: v.quote_amount,
    new_status: nextStatus !== ticket.status ? nextStatus : null,
    notes: v.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'quote_set',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { quote_amount: v.quote_amount, new_status: nextStatus },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Request approval ───────────────────────────────────────────────────────

export async function requestApprovalAction(
  ticketId: string,
): Promise<ActionResult> {
  if (!ticketId) return { error: 'missing_ticket_id' }
  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    ticketId,
  )
  if (ticket.status !== 'quoted') return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({ status: 'awaiting_approval', updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    new_status: 'awaiting_approval',
    notes: 'Approval requested',
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'update',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { kind: 'request_approval', new_status: 'awaiting_approval' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Approve quote ───────────────────────────────────────────────────────────

export async function approveQuoteAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairApproveQuoteSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.status !== 'awaiting_approval')
    return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      status: 'in_progress',
      quote_approved_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'approved',
    new_status: 'in_progress',
    notes: v.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'approve_quote',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'in_progress' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Collect deposit ─────────────────────────────────────────────────────────

export async function collectDepositAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairCollectDepositSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    deposit_amount: formData.get('deposit_amount'),
    payment_method: formData.get('payment_method') ?? 'cash',
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.is_locked) return { error: 'customer_locked' }

  const balance = computeBalanceDue({
    quote: ticket.quote_amount,
    deposit: v.deposit_amount,
  })

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      deposit_amount: v.deposit_amount,
      deposit_collected_at: new Date().toISOString(),
      balance_due: balance,
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    amount: v.deposit_amount,
    notes: `Deposit collected (${v.payment_method})${v.notes ? ` — ${v.notes}` : ''}`,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'collect_deposit',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      deposit_amount: v.deposit_amount,
      payment_method: v.payment_method,
    },
  })

  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

// ── Start work ──────────────────────────────────────────────────────────────

export async function startWorkAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairStartWorkSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    assigned_to: formData.get('assigned_to'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  const cur = ticket.status as RepairStatus
  if (cur !== 'awaiting_approval' && cur !== 'in_progress' && cur !== 'needs_parts') {
    return { error: 'illegalTransition' }
  }

  const patch: RepairTicketUpdate = {
    status: 'in_progress',
    updated_by: userId,
  }
  if (v.assigned_to !== undefined) patch.assigned_to = v.assigned_to

  const { error } = await supabase
    .from('repair_tickets')
    .update(patch)
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'started',
    new_status: 'in_progress',
    notes: v.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'start_work',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'in_progress', assigned_to: v.assigned_to ?? null },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Mark needs parts ────────────────────────────────────────────────────────

export async function markNeedsPartsAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairNeedsPartsSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  const fromStatus = ticket.status as RepairStatus
  if (!canTransition(fromStatus, 'needs_parts'))
    return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({ status: 'needs_parts', updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  // Auto-stop running timers when leaving in_progress.
  if (shouldStopTimerOnLeave(fromStatus)) {
    await stopRunningTimers({
      supabase,
      tenantId,
      ticketId: ticket.id,
      reason: 'needs_parts',
    })
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'parts_needed',
    new_status: 'needs_parts',
    notes: v.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'mark_needs_parts',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'needs_parts', notes: v.notes ?? null },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Parts received ─────────────────────────────────────────────────────────

export async function partsReceivedAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairPartsReceivedSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.status !== 'needs_parts') return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({ status: 'in_progress', updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  // Auto-open timer for the assigned tech when entering in_progress.
  // (No-op if no tech is assigned — operator can still hit Resume manually.)
  if (ticket.assigned_to && shouldOpenTimerOnEnter('in_progress')) {
    await openTimerForTech({
      supabase,
      tenantId,
      ticketId: ticket.id,
      techUserId: ticket.assigned_to,
      reason: 'parts_received',
    })
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'parts_received',
    new_status: 'in_progress',
    notes: v.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'parts_received',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'in_progress' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

// ── Mark complete ──────────────────────────────────────────────────────────

export async function markCompleteAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairCompleteSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  const cur = ticket.status as RepairStatus
  if (cur !== 'in_progress' && cur !== 'needs_parts')
    return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      status: 'ready',
      completed_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  // Auto-stop any running timer (in_progress always has one open if a
  // tech claimed; needs_parts won't but the call is a no-op).
  if (shouldStopTimerOnLeave(cur)) {
    await stopRunningTimers({
      supabase,
      tenantId,
      ticketId: ticket.id,
      reason: 'ready',
    })
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'completed',
    new_status: 'ready',
    notes: v.notes,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'mark_complete',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'ready' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Record pickup ──────────────────────────────────────────────────────────

export async function recordPickupAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairPickupSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    pickup_by_name: formData.get('pickup_by_name'),
    pickup_id_check: formData.get('pickup_id_check'),
    payment_method: formData.get('payment_method') ?? 'cash',
    paid_amount: formData.get('paid_amount'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.status !== 'ready') return { error: 'illegalTransition' }

  // Optional signature upload to repair-photos bucket under pickup folder.
  let signaturePath: string | null = null
  const sigFile = formData.get('signature_file')
  if (sigFile instanceof File && sigFile.size > 0) {
    if (sigFile.size > MAX_REPAIR_SIGNATURE_BYTES)
      return { error: 'tooLarge' }
    if (!ALLOWED_REPAIR_SIGNATURE_MIME_TYPES.includes(sigFile.type as never))
      return { error: 'mimeNotAllowed' }
    const ext = pickExt(sigFile.type, sigFile.name)
    const path = `${tenantId}/${ticket.id}/pickup/signature_${newUuid()}.${ext}`
    try {
      await uploadToBucket({
        bucket: REPAIR_PHOTOS_BUCKET,
        path,
        body: sigFile,
        contentType: sigFile.type,
      })
      signaturePath = path
    } catch (err) {
      console.error('[repair.pickup] signature upload failed', err)
    }
  }

  const newPaid = r4(
    Number(ticket.paid_amount ?? 0) + Number(v.paid_amount ?? 0),
  )

  // Re-derive balance due so any payment further reduces it.
  const balance = computeBalanceDue({
    quote: ticket.quote_amount,
    deposit: ticket.deposit_amount,
    paymentsApplied: newPaid,
  })

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      status: 'picked_up',
      picked_up_at: new Date().toISOString(),
      pickup_by_name: v.pickup_by_name,
      pickup_id_check: v.pickup_id_check,
      pickup_signature_path: signaturePath,
      paid_amount: newPaid,
      balance_due: balance,
      is_locked: true,
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'pickup',
    new_status: 'picked_up',
    amount: v.paid_amount,
    notes: `${v.pickup_by_name}${v.notes ? ` — ${v.notes}` : ''}`,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'record_pickup',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      pickup_by_name: v.pickup_by_name,
      payment_method: v.payment_method,
      paid_amount: v.paid_amount,
      signature_uploaded: !!signaturePath,
      new_status: 'picked_up',
    },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Mark abandoned (+ convert to inventory) ───────────────────────────────

export async function markAbandonedAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairAbandonSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    abandon_reason: formData.get('abandon_reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  const fromStatus = ticket.status as RepairStatus
  if (!canTransition(fromStatus, 'abandoned'))
    return { error: 'illegalTransition' }
  if (shouldStopTimerOnLeave(fromStatus)) {
    await stopRunningTimers({
      supabase,
      tenantId,
      ticketId: ticket.id,
      reason: 'abandoned',
    })
  }

  // 1. Flip to abandoned + lock.
  const { error: upErr } = await supabase
    .from('repair_tickets')
    .update({
      status: 'abandoned',
      is_locked: true,
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (upErr) return { error: upErr.message }

  // 2. Event.
  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'abandoned_conversion',
    new_status: 'abandoned',
    notes: v.abandon_reason,
    performed_by: userId,
  })

  // 3. Convert to inventory. Item description carried from the ticket; the
  //    enum value 'abandoned_repair' already exists in inventory_source as of
  //    patches/0003. SKU auto-assigns via the inventory trigger.
  const { data: invRow, error: invErr } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: tenantId,
      sku: '',
      sku_number: 0,
      description: ticket.item_description,
      category: 'other',
      cost_basis: 0,
      source: 'abandoned_repair',
      acquired_at: new Date().toISOString().slice(0, 10),
      acquired_cost: 0,
      location: 'safe',
      status: 'available',
      notes: `Abandoned from repair ticket ${ticket.ticket_number ?? ticket.id}`,
      created_by: userId,
      updated_by: userId,
    })
    .select('id')
    .single()

  if (invErr || !invRow) {
    console.error(
      '[repair.abandon] inventory insert failed',
      invErr?.message,
    )
  } else {
    // Back-link the new inventory id to the source ticket.
    await supabase
      .from('repair_tickets')
      .update({ source_inventory_item_id: invRow.id })
      .eq('id', ticket.id)
      .eq('tenant_id', tenantId)

    await logAudit({
      tenantId,
      userId,
      action: 'create',
      tableName: 'inventory_items',
      recordId: invRow.id,
      changes: {
        source: 'abandoned_repair',
        from_repair_ticket_id: ticket.id,
        description: ticket.item_description,
      },
    })
  }

  await logAudit({
    tenantId,
    userId,
    action: 'mark_abandoned',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      reason: v.abandon_reason,
      created_inventory_id: invRow?.id ?? null,
      new_status: 'abandoned',
    },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  revalidatePath('/inventory')
  return { ok: true }
}

// ── Void ────────────────────────────────────────────────────────────────────

export async function voidTicketAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairVoidSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  const fromStatus = ticket.status as RepairStatus
  if (!canTransition(fromStatus, 'voided'))
    return { error: 'illegalTransition' }
  if (shouldStopTimerOnLeave(fromStatus)) {
    await stopRunningTimers({
      supabase,
      tenantId,
      ticketId: ticket.id,
      reason: 'voided',
    })
  }

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      status: 'voided',
      is_locked: true,
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'void',
    new_status: 'voided',
    notes: v.reason,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'void',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { reason: v.reason, new_status: 'voided' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Assign technician ──────────────────────────────────────────────────────

export async function assignTechnicianAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairAssignSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    assigned_to: formData.get('assigned_to'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  // Routing a ticket is a manager-level decision (it changes who is
  // accountable for the work). Tech members can self-assign by claiming
  // an unassigned ticket, but they shouldn't be moving tickets between
  // jewelers from this surface.
  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
    MANAGER_ROLES,
  )
  const cur = ticket.status as RepairStatus

  // Decide the new status.
  // - awaiting_approval → assigned (the standard route-after-quote path)
  // - assigned          → assigned (re-routing to a different tech)
  // - in_progress / needs_parts / tech_qa → keep status (mid-work
  //   re-assignment; rare but legal)
  // - intake / quoted / terminal → refuse
  let nextStatus: RepairStatus = cur
  let isFirstAssign = false
  if (cur === 'awaiting_approval') {
    nextStatus = 'assigned'
    isFirstAssign = true
  } else if (cur === 'assigned') {
    nextStatus = 'assigned'
  } else if (
    cur === 'in_progress' ||
    cur === 'needs_parts' ||
    cur === 'tech_qa'
  ) {
    nextStatus = cur
  } else {
    return { error: 'illegalTransition' }
  }

  const patch: RepairTicketUpdate = {
    assigned_to: v.assigned_to,
    updated_by: userId,
  }
  if (nextStatus !== cur) patch.status = nextStatus
  // Stamp assigned_at on the FIRST routing only — re-assignment keeps
  // the original timestamp so we can measure how long the queue took.
  if (isFirstAssign || ticket.assigned_at == null) {
    patch.assigned_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('repair_tickets')
    .update(patch)
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'assigned_to_tech',
    new_status: nextStatus !== cur ? nextStatus : null,
    notes: null,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'assign_technician',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: {
      assigned_to: v.assigned_to ?? null,
      new_status: nextStatus !== cur ? nextStatus : null,
    },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Tech actions: claim / send-to-QA / approve-QA / return-from-QA ────────

/**
 * Claim an `assigned` ticket and start work. Auto-opens a time log so
 * the jeweler doesn't have to remember a separate punch-in step. The
 * assigned tech (or a manager override) is the only one who can claim.
 */
export async function claimTicketAction(
  formData: FormData,
): Promise<ActionResult> {
  const ticketIdRaw = formData.get('ticket_id')
  if (typeof ticketIdRaw !== 'string' || !ticketIdRaw)
    return { error: 'validation_failed' }

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    ticketIdRaw,
    TECH_ROLES,
  )

  if (ticket.status !== 'assigned') return { error: 'illegalTransition' }

  // Authorization: must be the assigned tech, or a manager-level role.
  // Manager override lets owners reassign-and-claim in one step if a
  // jeweler is out and the ticket needs to move.
  const { data: myMembership } = await supabase
    .from('user_tenants')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  const myRole = myMembership?.role as TenantRole | undefined
  const isManager =
    myRole === 'owner' || myRole === 'manager' || myRole === 'chain_admin'
  if (!isManager && ticket.assigned_to !== userId) {
    return { error: 'notAuthorized' }
  }

  // If a manager is claiming for someone else, also re-route assigned_to
  // to the claiming user so the timer + audit trail line up.
  const claimingTechId = isManager && ticket.assigned_to == null
    ? userId
    : (ticket.assigned_to ?? userId)

  const patch: RepairTicketUpdate = {
    status: 'in_progress',
    claimed_at: new Date().toISOString(),
    updated_by: userId,
  }
  if (ticket.assigned_to == null) patch.assigned_to = claimingTechId

  const { error } = await supabase
    .from('repair_tickets')
    .update(patch)
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await openTimerForTech({
    supabase,
    tenantId,
    ticketId: ticket.id,
    techUserId: claimingTechId,
    reason: 'claim',
  })

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'claimed_by_tech',
    new_status: 'in_progress',
    notes: null,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'claim_ticket',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'in_progress', claimed_by: claimingTechId },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

/**
 * Tech finished hands-on work — move to tech_qa and stop the timer.
 * Final QA pass before marking the ticket ready for customer pickup.
 */
export async function sendToQaAction(
  formData: FormData,
): Promise<ActionResult> {
  const ticketIdRaw = formData.get('ticket_id')
  const notes = formData.get('notes')
  if (typeof ticketIdRaw !== 'string' || !ticketIdRaw)
    return { error: 'validation_failed' }

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    ticketIdRaw,
    TECH_ROLES,
  )

  if (!canTransition(ticket.status as RepairStatus, 'tech_qa'))
    return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({ status: 'tech_qa', updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  if (shouldStopTimerOnLeave('in_progress')) {
    await stopRunningTimers({
      supabase,
      tenantId,
      ticketId: ticket.id,
      reason: 'qa',
    })
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'qa_started',
    new_status: 'tech_qa',
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'send_to_qa',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'tech_qa' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

/**
 * QA passes — mark ready for customer pickup. Same end state as
 * markCompleteAction, but the source is the tech_qa stage so the audit
 * trail records 'qa_completed' instead of 'completed'.
 */
export async function approveQaAction(
  formData: FormData,
): Promise<ActionResult> {
  const ticketIdRaw = formData.get('ticket_id')
  const notes = formData.get('notes')
  if (typeof ticketIdRaw !== 'string' || !ticketIdRaw)
    return { error: 'validation_failed' }

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    ticketIdRaw,
    TECH_ROLES,
  )

  if (ticket.status !== 'tech_qa') return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({
      status: 'ready',
      completed_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'qa_completed',
    new_status: 'ready',
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'approve_qa',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'ready' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

/**
 * QA failed — send back to in_progress for more work. Reopens the
 * timer for the assigned tech.
 */
export async function returnFromQaAction(
  formData: FormData,
): Promise<ActionResult> {
  const ticketIdRaw = formData.get('ticket_id')
  const notes = formData.get('notes')
  if (typeof ticketIdRaw !== 'string' || !ticketIdRaw)
    return { error: 'validation_failed' }

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    ticketIdRaw,
    TECH_ROLES,
  )

  if (ticket.status !== 'tech_qa') return { error: 'illegalTransition' }
  if (!canTransition('tech_qa', 'in_progress'))
    return { error: 'illegalTransition' }

  const { error } = await supabase
    .from('repair_tickets')
    .update({ status: 'in_progress', updated_by: userId })
    .eq('id', ticket.id)
    .eq('tenant_id', tenantId)
  if (error) return { error: error.message }

  if (ticket.assigned_to && shouldOpenTimerOnEnter('in_progress')) {
    await openTimerForTech({
      supabase,
      tenantId,
      ticketId: ticket.id,
      techUserId: ticket.assigned_to,
      reason: 'qa_returned',
    })
  }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'qa_returned',
    new_status: 'in_progress',
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'return_from_qa',
    tableName: 'repair_tickets',
    recordId: ticket.id,
    changes: { new_status: 'in_progress' },
  })

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/repair')
  return { ok: true }
}

// ── Add note ───────────────────────────────────────────────────────────────

export async function addNoteAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairAddNoteSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: v.notes,
    performed_by: userId,
  })
  await logAudit({
    tenantId,
    userId,
    action: 'add_note',
    tableName: 'repair_ticket_events',
    recordId: ticket.id,
    changes: { notes: v.notes },
  })
  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

// ── Stones ──────────────────────────────────────────────────────────────────

export async function addStoneAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairAddStoneSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    stone_index: formData.get('stone_index'),
    stone_type: formData.get('stone_type'),
    shape: formData.get('shape'),
    size_mm: formData.get('size_mm'),
    weight_carats: formData.get('weight_carats'),
    color: formData.get('color'),
    clarity: formData.get('clarity'),
    mounting_type: formData.get('mounting_type'),
    mounting_position: formData.get('mounting_position'),
    source: formData.get('source'),
    shop_inventory_item_id: formData.get('shop_inventory_item_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.is_locked) return { error: 'customer_locked' }

  const { data: inserted, error } = await supabase
    .from('repair_ticket_stones')
    .insert({
      ticket_id: ticket.id,
      tenant_id: tenantId,
      stone_index: v.stone_index,
      stone_type: v.stone_type,
      shape: v.shape,
      size_mm: v.size_mm,
      weight_carats: v.weight_carats,
      color: v.color,
      clarity: v.clarity,
      mounting_type: v.mounting_type,
      mounting_position: v.mounting_position,
      source: v.source,
      shop_inventory_item_id: v.shop_inventory_item_id,
      notes: v.notes,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: `Stone added (${v.stone_type})`,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'add_stone_repair',
    tableName: 'repair_ticket_stones',
    recordId: inserted?.id ?? ticket.id,
    changes: {
      stone_index: v.stone_index,
      stone_type: v.stone_type,
      source: v.source,
    },
  })

  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

export async function removeStoneAction(
  stoneId: string,
): Promise<ActionResult> {
  if (!stoneId) return { error: 'missing_stone_id' }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: stone } = await ctx.supabase
    .from('repair_ticket_stones')
    .select('id, tenant_id, ticket_id')
    .eq('id', stoneId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!stone) return { error: 'not_found' }
  const { supabase, userId } = await requireRoleInTenant(
    stone.tenant_id,
    STAFF_REPAIR_ROLES,
  )

  const { error } = await supabase
    .from('repair_ticket_stones')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', stoneId)
    .eq('tenant_id', stone.tenant_id)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: stone.tenant_id,
    userId,
    action: 'remove_stone_repair',
    tableName: 'repair_ticket_stones',
    recordId: stoneId,
    changes: { ticket_id: stone.ticket_id },
  })

  revalidatePath(`/repair/${stone.ticket_id}`)
  return { ok: true }
}

// ── Parts ──────────────────────────────────────────────────────────────────

export async function addPartAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairAddPartSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    inventory_item_id: formData.get('inventory_item_id'),
    description: formData.get('description'),
    quantity: formData.get('quantity'),
    unit_cost: formData.get('unit_cost'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )
  if (ticket.is_locked) return { error: 'customer_locked' }

  const total = lineTotalCost({ quantity: v.quantity, unit_cost: v.unit_cost })

  const { data: inserted, error } = await supabase
    .from('repair_ticket_items')
    .insert({
      ticket_id: ticket.id,
      tenant_id: tenantId,
      inventory_item_id: v.inventory_item_id,
      description: v.description,
      quantity: v.quantity,
      unit_cost: v.unit_cost,
      total_cost: total,
      notes: v.notes,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'add_part',
    tableName: 'repair_ticket_items',
    recordId: inserted?.id ?? ticket.id,
    changes: {
      description: v.description,
      quantity: v.quantity,
      unit_cost: v.unit_cost,
      total_cost: total,
      inventory_item_id: v.inventory_item_id ?? null,
    },
  })

  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

export async function removePartAction(
  partId: string,
): Promise<ActionResult> {
  if (!partId) return { error: 'missing_part_id' }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: part } = await ctx.supabase
    .from('repair_ticket_items')
    .select('id, tenant_id, ticket_id')
    .eq('id', partId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!part) return { error: 'not_found' }
  const { supabase, userId } = await requireRoleInTenant(
    part.tenant_id,
    STAFF_REPAIR_ROLES,
  )

  const { error } = await supabase
    .from('repair_ticket_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', partId)
    .eq('tenant_id', part.tenant_id)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: part.tenant_id,
    userId,
    action: 'remove_part',
    tableName: 'repair_ticket_items',
    recordId: partId,
    changes: { ticket_id: part.ticket_id },
  })

  revalidatePath(`/repair/${part.ticket_id}`)
  return { ok: true }
}

// ── Photos ──────────────────────────────────────────────────────────────────

export async function addPhotoAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairAddPhotoSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    kind: formData.get('kind'),
    caption: formData.get('caption'),
    position: formData.get('position'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
  )

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0)
    return { error: 'missing_file' }
  if (file.size > MAX_REPAIR_PHOTO_BYTES) return { error: 'tooLarge' }
  if (!ALLOWED_REPAIR_PHOTO_MIME_TYPES.includes(file.type as never))
    return { error: 'mimeNotAllowed' }

  const ext = pickExt(file.type, file.name)
  const path = `${tenantId}/${ticket.id}/${v.kind}/${newUuid()}.${ext}`
  try {
    await uploadToBucket({
      bucket: REPAIR_PHOTOS_BUCKET,
      path,
      body: file,
      contentType: file.type,
    })
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'uploadFailed',
    }
  }

  const { data: inserted, error } = await supabase
    .from('repair_ticket_photos')
    .insert({
      ticket_id: ticket.id,
      tenant_id: tenantId,
      storage_path: path,
      kind: v.kind,
      caption: v.caption,
      position: v.position,
      uploaded_by: userId,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'photo_added',
    notes: `${v.kind} photo`,
    performed_by: userId,
  })

  await logAudit({
    tenantId,
    userId,
    action: 'photo_upload_repair',
    tableName: 'repair_ticket_photos',
    recordId: inserted?.id ?? ticket.id,
    changes: { kind: v.kind },
  })

  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

export async function removePhotoAction(
  photoId: string,
): Promise<ActionResult> {
  if (!photoId) return { error: 'missing_photo_id' }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: photo } = await ctx.supabase
    .from('repair_ticket_photos')
    .select('id, tenant_id, ticket_id, storage_path')
    .eq('id', photoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!photo) return { error: 'not_found' }
  const { supabase, userId } = await requireRoleInTenant(
    photo.tenant_id,
    STAFF_REPAIR_ROLES,
  )

  const { error } = await supabase
    .from('repair_ticket_photos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', photoId)
    .eq('tenant_id', photo.tenant_id)
  if (error) return { error: error.message }

  // Best-effort storage cleanup.
  await deleteFromBucket({
    bucket: REPAIR_PHOTOS_BUCKET,
    path: photo.storage_path,
  })

  await logAudit({
    tenantId: photo.tenant_id,
    userId,
    action: 'photo_delete_repair',
    tableName: 'repair_ticket_photos',
    recordId: photoId,
    changes: { ticket_id: photo.ticket_id },
  })

  revalidatePath(`/repair/${photo.ticket_id}`)
  return { ok: true }
}

export async function setPhotoCaptionAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairSetCaptionSchema.safeParse({
    photo_id: formData.get('photo_id'),
    caption: formData.get('caption'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: photo } = await ctx.supabase
    .from('repair_ticket_photos')
    .select('id, tenant_id, ticket_id')
    .eq('id', v.photo_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!photo) return { error: 'not_found' }
  const { supabase, userId } = await requireRoleInTenant(
    photo.tenant_id,
    STAFF_REPAIR_ROLES,
  )

  const { error } = await supabase
    .from('repair_ticket_photos')
    .update({ caption: v.caption })
    .eq('id', v.photo_id)
    .eq('tenant_id', photo.tenant_id)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: photo.tenant_id,
    userId,
    action: 'photo_caption',
    tableName: 'repair_ticket_photos',
    recordId: v.photo_id,
    changes: { caption: v.caption },
  })

  revalidatePath(`/repair/${photo.ticket_id}`)
  return { ok: true }
}

// ── Timer ──────────────────────────────────────────────────────────────────

export async function startTimerAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairTimeStartSchema.safeParse({
    ticket_id: formData.get('ticket_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await resolveTicketScope(
    v.ticket_id,
    TECH_ROLES,
  )

  // Check no other open timer for this user on this ticket.
  const { data: existing } = await supabase
    .from('repair_time_logs')
    .select('id')
    .eq('ticket_id', ticket.id)
    .eq('technician_id', userId)
    .is('stopped_at', null)
    .maybeSingle()
  if (existing) return { error: 'timerAlreadyRunning' }

  const { data: inserted, error } = await supabase
    .from('repair_time_logs')
    .insert({
      ticket_id: ticket.id,
      tenant_id: tenantId,
      technician_id: userId,
      started_at: new Date().toISOString(),
      notes: v.notes,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    userId,
    action: 'timer_start',
    tableName: 'repair_time_logs',
    recordId: inserted?.id ?? ticket.id,
    changes: { ticket_id: ticket.id },
  })

  revalidatePath(`/repair/${ticket.id}`)
  return { ok: true }
}

export async function stopTimerAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = repairTimeStopSchema.safeParse({
    time_log_id: formData.get('time_log_id'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'validation_failed' }
  const v = parsed.data

  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: log } = await ctx.supabase
    .from('repair_time_logs')
    .select('id, tenant_id, ticket_id, technician_id, stopped_at')
    .eq('id', v.time_log_id)
    .maybeSingle()
  if (!log) return { error: 'timerNotFound' }
  if (log.stopped_at != null) return { error: 'timerNotFound' }
  if (log.technician_id !== ctx.userId) return { error: 'notAuthorized' }
  const { supabase, userId } = await requireRoleInTenant(log.tenant_id, TECH_ROLES)

  const patch: RepairTimeLogUpdate = {
    stopped_at: new Date().toISOString(),
  }
  if (v.notes) patch.notes = v.notes

  const { error } = await supabase
    .from('repair_time_logs')
    .update(patch)
    .eq('id', v.time_log_id)
    .eq('tenant_id', log.tenant_id)
  if (error) return { error: error.message }

  await logAudit({
    tenantId: log.tenant_id,
    userId,
    action: 'timer_stop',
    tableName: 'repair_time_logs',
    recordId: v.time_log_id,
    changes: { ticket_id: log.ticket_id },
  })

  revalidatePath(`/repair/${log.ticket_id}`)
  return { ok: true }
}
