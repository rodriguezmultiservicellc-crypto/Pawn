'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import {
  ALLOWED_REPAIR_PHOTO_MIME_TYPES,
  MAX_REPAIR_PHOTO_BYTES,
  repairTicketCreateSchema,
} from '@/lib/validations/repair'
import {
  REPAIR_PHOTOS_BUCKET,
  uploadToBucket,
} from '@/lib/supabase/storage'
import { logAudit } from '@/lib/audit'

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
  return 'bin'
}

function newUuid(): string {
  return crypto.randomUUID()
}

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

  const parsed = repairTicketCreateSchema.safeParse({
    customer_id: formData.get('customer_id'),
    service_type: formData.get('service_type'),
    title: formData.get('title'),
    item_description: formData.get('item_description'),
    description: formData.get('description'),
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
    return { fieldErrors }
  }

  const v = parsed.data

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
      service_type: v.service_type,
      title: v.title,
      description: v.description,
      item_description: v.item_description,
      promised_date: v.promised_date,
      assigned_to: v.assigned_to,
      notes_internal: v.notes_internal,
      status: 'intake',
      created_by: userId,
      updated_by: userId,
    })
    .select('id, ticket_number')
    .single()
  if (tErr || !ticket) return { error: tErr?.message ?? 'insert_failed' }
  const ticketId = ticket.id

  // 2. Insert stones.
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

  // 3. Upload intake photos. Multiple files under 'intake_files' (FormData
  //    appends — getAll picks them all up).
  const photoFiles = formData
    .getAll('intake_files')
    .filter((v): v is File => v instanceof File && v.size > 0)
  let photoCount = 0
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i]
    if (f.size > MAX_REPAIR_PHOTO_BYTES) continue
    if (!ALLOWED_REPAIR_PHOTO_MIME_TYPES.includes(f.type as never)) continue
    const ext = pickExt(f.type, f.name)
    const path = `${tenantId}/${ticketId}/intake/${newUuid()}.${ext}`
    try {
      await uploadToBucket({
        bucket: REPAIR_PHOTOS_BUCKET,
        path,
        body: f,
        contentType: f.type,
      })
      await supabase.from('repair_ticket_photos').insert({
        ticket_id: ticketId,
        tenant_id: tenantId,
        storage_path: path,
        kind: 'intake',
        position: i,
        uploaded_by: userId,
      })
      photoCount++
    } catch (err) {
      console.error('[repair.create] intake photo upload failed', err)
    }
  }

  // 4. Intake event.
  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticketId,
    tenant_id: tenantId,
    event_type: 'intake',
    new_status: 'intake',
    performed_by: userId,
  })

  // 5. Audit.
  await logAudit({
    tenantId,
    userId,
    action: 'create',
    tableName: 'repair_tickets',
    recordId: ticketId,
    changes: {
      ticket_number: ticket.ticket_number,
      service_type: v.service_type,
      customer_id: v.customer_id,
      title: v.title,
      stones_count: v.stones?.length ?? 0,
      photos_count: photoCount,
    },
  })

  revalidatePath('/repair')
  redirect(`/repair/${ticketId}`)
}
