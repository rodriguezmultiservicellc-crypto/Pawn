'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { repairTicketCreateSchema } from '@/lib/validations/repair'
import {
  deriveItemDescription,
  deriveTicketTitle,
} from '@/lib/repair/line-items'
import { confirmIntakePhotos } from '@/lib/uploads/intake-photos-server'
import { logAudit } from '@/lib/audit'
import { applyRepairQuote } from '@/lib/repair/quote'
import { r4 } from '@/lib/repair/billing'

export type CreateRepairTicketState = {
  error?: string
  fieldErrors?: Record<string, string>
}

const STAFF_REPAIR_ROLES = [
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'chain_admin',
] as const

/** Pull `stones[<n>][<field>]` style entries out of FormData. */
function readStoneRows(fd: FormData) {
  const countRaw = fd.get('stone_count')
  const count = Math.max(
    0,
    Math.min(50, parseInt(String(countRaw ?? '0'), 10) || 0),
  )
  const rows: Array<Record<string, FormDataEntryValue | null>> = []
  for (let i = 0; i < count; i++) {
    rows.push({
      stone_index: String(i + 1),
      stone_type: fd.get(`stone_${i}_type`),
      shape: fd.get(`stone_${i}_shape`),
      size_mm: fd.get(`stone_${i}_size_mm`),
      weight_carats: fd.get(`stone_${i}_weight_carats`),
      color: fd.get(`stone_${i}_color`),
      clarity: fd.get(`stone_${i}_clarity`),
      mounting_type: fd.get(`stone_${i}_mounting_type`),
      mounting_position: fd.get(`stone_${i}_mounting_position`),
      source: fd.get(`stone_${i}_source`),
      notes: fd.get(`stone_${i}_notes`),
    })
  }
  return rows.filter(
    (r) => typeof r.stone_type === 'string' && r.stone_type.trim().length > 0,
  )
}

/** Pull `li_<n>_<field>` line-item entries out of FormData. */
function readLineItemRows(fd: FormData) {
  const countRaw = fd.get('line_item_count')
  const count = Math.max(
    0,
    Math.min(30, parseInt(String(countRaw ?? '0'), 10) || 0),
  )
  const rows: Array<Record<string, FormDataEntryValue | null>> = []
  for (let i = 0; i < count; i++) {
    rows.push({
      item_type: fd.get(`li_${i}_item_type`),
      karat: fd.get(`li_${i}_karat`),
      weight_grams: fd.get(`li_${i}_weight_grams`),
      dimension: fd.get(`li_${i}_dimension`),
      title: fd.get(`li_${i}_title`),
      service_type: fd.get(`li_${i}_service_type`),
      work_needed: fd.get(`li_${i}_work_needed`),
      price: fd.get(`li_${i}_price`),
      // The item's photos: a JSON list of paths the browser already uploaded
      // to repair-photos/<tenant>/intake/ (patches/0119).
      photos: fd.get(`li_${i}_photos`),
    })
  }
  // Keep only rows the operator actually built (an item type was chosen).
  return rows.filter(
    (r) => typeof r.item_type === 'string' && r.item_type.trim().length > 0,
  )
}

export async function createRepairTicketAction(
  _prev: CreateRepairTicketState,
  formData: FormData,
): Promise<CreateRepairTicketState> {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  if (!ctx.tenantId) redirect('/no-tenant')

  // Module + role gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  const { supabase, userId } = await requireRoleInTenant(
    ctx.tenantId,
    STAFF_REPAIR_ROLES,
  )
  const tenantId = ctx.tenantId

  const stoneRows = readStoneRows(formData)
  const lineItemRows = readLineItemRows(formData)

  const parsed = repairTicketCreateSchema.safeParse({
    customer_id: formData.get('customer_id'),
    line_items: lineItemRows,
    promised_date: formData.get('promised_date'),
    assigned_to: formData.get('assigned_to'),
    notes_internal: formData.get('notes_internal'),
    stones: stoneRows,
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.')
      if (path) fieldErrors[path] = issue.message
    }
    // Surface the array-level "need at least one item" message on a stable key.
    if (!fieldErrors.line_items && lineItemRows.length === 0) {
      fieldErrors.line_items = 'at_least_one_item'
    }
    // An item with no work described: shown at the items list.
    if (
      !fieldErrors.line_items &&
      parsed.error.issues.some((i) => i.path[0] === 'line_items' && i.path[2] === 'work_needed')
    ) {
      fieldErrors.line_items = 'work_required'
    }
    return { fieldErrors }
  }

  const v = parsed.data

  // Each item's photos, checked BEFORE anything is written: this shop's
  // intake folder, and really in storage (rule 28). A list that fails is
  // refused whole — never a ticket missing a photo the clerk saw.
  const itemPhotos: string[][] = []
  for (const row of lineItemRows) {
    const confirmed = await confirmIntakePhotos(row.photos, tenantId, 'repair-photos')
    if (!confirmed.ok) return { error: 'photos_invalid' }
    itemPhotos.push(confirmed.paths)
  }

  // Ticket-level title / item_description / service_type are DERIVED from the
  // line items so every existing reader (list, board, detail, portal, feed)
  // keeps working. The first item's service_type represents the ticket.
  const ticketServiceType = v.line_items[0].service_type
  const ticketTitle = deriveTicketTitle(v.line_items)
  const itemDescription = deriveItemDescription(v.line_items)

  // Defense-in-depth: confirm customer is in this tenant.
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', v.customer_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { error: 'customer_not_found' }

  // 1. Insert the ticket. Trigger assigns ticket_number.
  const { data: ticket, error: tErr } = await supabase
    .from('repair_tickets')
    .insert({
      tenant_id: tenantId,
      customer_id: v.customer_id,
      service_type: ticketServiceType,
      title: ticketTitle,
      description: null,
      item_description: itemDescription,
      promised_date: v.promised_date,
      assigned_to: v.assigned_to,
      notes_internal: v.notes_internal,
      status: 'intake',
      created_by: userId,
      updated_by: userId,
    })
    .select('id, ticket_number, status, deposit_amount')
    .single()
  if (tErr || !ticket) return { error: tErr?.message ?? 'insert_failed' }
  const ticketId = ticket.id

  // 2. Insert line items (one row per customer item).
  let lineItemIds: string[] = []
  {
    const rows = v.line_items.map((li, idx) => ({
      ticket_id: ticketId,
      tenant_id: tenantId,
      line_index: idx + 1,
      item_type: li.item_type,
      karat: li.karat,
      weight_grams: li.weight_grams,
      dimension: li.dimension,
      title: li.title,
      service_type: li.service_type,
      work_needed: li.work_needed,
      price: li.price,
    }))
    const { data: inserted, error: liErr } = await supabase
      .from('repair_ticket_line_items')
      .insert(rows)
      .select('id, line_index')
    if (liErr || !inserted) return { error: liErr?.message ?? 'insert_failed' }
    lineItemIds = inserted
      .slice()
      .sort((a, b) => a.line_index - b.line_index)
      .map((li) => li.id)
  }

  // 4. Insert stones.
  if (v.stones && v.stones.length > 0) {
    const rows = v.stones.map((s, idx) => ({
      ticket_id: ticketId,
      tenant_id: tenantId,
      stone_index: s.stone_index ?? idx + 1,
      stone_type: s.stone_type,
      shape: s.shape,
      size_mm: s.size_mm,
      weight_carats: s.weight_carats,
      color: s.color,
      clarity: s.clarity,
      mounting_type: s.mounting_type,
      mounting_position: s.mounting_position,
      source: s.source,
      shop_inventory_item_id: s.shop_inventory_item_id,
      notes: s.notes,
    }))
    await supabase.from('repair_ticket_stones').insert(rows)
  }

  // 5. Intake photos: already in storage (uploaded by the browser); each one
  //    is recorded with the item it was taken for (patches/0119).
  const photoRows = itemPhotos.flatMap((paths, item) =>
    paths.map((path, position) => ({
      ticket_id: ticketId,
      tenant_id: tenantId,
      line_item_id: lineItemIds[item] ?? null,
      storage_path: path,
      kind: 'intake' as const,
      position,
      uploaded_by: userId,
    })),
  )
  if (photoRows.length > 0) {
    const { error: phErr } = await supabase.from('repair_ticket_photos').insert(photoRows)
    if (phErr) console.error('[repair.create] intake photos not recorded', phErr)
  }
  const photoCount = photoRows.length

  // 6. Intake event.
  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticketId,
    tenant_id: tenantId,
    event_type: 'intake',
    new_status: 'intake',
    performed_by: userId,
  })

  // 6b. Every item priced at intake (patches/0122): their sum is the
  //     ticket's quote, set the way "Set quote" sets it. Best-effort like
  //     the rest after the ticket row: the clerk can still set it by hand.
  const prices = v.line_items.map((li) => li.price)
  if (prices.every((p): p is number => p != null)) {
    const total = r4(prices.reduce((sum, p) => sum + p, 0))
    if (total > 0) {
      const quoted = await applyRepairQuote({
        supabase,
        tenantId,
        userId,
        ticket,
        amount: total,
        notes: null,
      })
      if ('error' in quoted) console.error('[repair.create] quote not set', quoted.error)
    }
  }

  // 7. Audit.
  await logAudit({
    tenantId,
    userId,
    action: 'create',
    tableName: 'repair_tickets',
    recordId: ticketId,
    changes: {
      ticket_number: ticket.ticket_number,
      service_type: ticketServiceType,
      customer_id: v.customer_id,
      title: ticketTitle,
      line_items_count: v.line_items.length,
      stones_count: v.stones?.length ?? 0,
      photos_count: photoCount,
    },
  })

  // Opened from a draft (the QR handoff, patches/0118): the draft is done.
  // Best-effort — the ticket is already written; a stale draft is harmless.
  // The computer that showed the code sees 'gone' and closes its copy.
  const draftId = String(formData.get('draft_id') ?? '').trim()
  if (draftId) {
    await supabase
      .from('repair_drafts')
      .update({ deleted_at: new Date().toISOString(), updated_by: userId })
      .eq('id', draftId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
  }

  revalidatePath('/repair')
  redirect(`/repair/${ticketId}`)
}
