import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/supabase/ctx'
import {
  REPAIR_PHOTOS_BUCKET,
  getSignedUrl,
} from '@/lib/supabase/storage'
import RepairTicketDetail, {
  type InventoryPartChoice,
  type RepairPartView,
  type RepairPhotoView,
  type RepairStoneView,
  type RepairEventView,
  type RepairTicketView,
  type RepairTimeLogView,
  type TechnicianOption,
} from './content'
import type {
  RepairEventType,
  RepairPhotoKind,
  RepairStatus,
  ServiceType,
} from '@/types/database-aliases'

type Params = Promise<{ id: string }>

export default async function RepairTicketDetailPage(props: {
  params: Params
}) {
  const { id } = await props.params
  const ctx = await getCtx()
  if (!ctx) redirect('/login')

  const { data: ticket } = await ctx.supabase
    .from('repair_tickets')
    .select(
      `id, tenant_id, customer_id, ticket_number, service_type, title, description,
       item_description, quote_amount, quote_set_at, quote_approved_at,
       deposit_amount, deposit_collected_at, balance_due, paid_amount,
       promised_date, completed_at, picked_up_at, pickup_by_name,
       pickup_signature_path, pickup_id_check, assigned_to, status,
       source_inventory_item_id, is_locked, notes_internal,
       created_at, updated_at,
       customer:customers(id, first_name, last_name, phone, email)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!ticket) redirect('/repair')

  // Module gate.
  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('has_repair')
    .eq('id', ticket.tenant_id)
    .maybeSingle()
  if (!tenant?.has_repair) redirect('/dashboard')

  const [
    { data: stones },
    { data: parts },
    { data: photos },
    { data: events },
    { data: timeLogs },
  ] = await Promise.all([
    ctx.supabase
      .from('repair_ticket_stones')
      .select(
        'id, stone_index, stone_type, shape, size_mm, weight_carats, color, clarity, mounting_type, mounting_position, source, shop_inventory_item_id, notes',
      )
      .eq('ticket_id', id)
      .is('deleted_at', null)
      .order('stone_index', { ascending: true }),
    ctx.supabase
      .from('repair_ticket_items')
      .select(
        'id, inventory_item_id, description, quantity, unit_cost, total_cost, notes',
      )
      .eq('ticket_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    ctx.supabase
      .from('repair_ticket_photos')
      .select('id, storage_path, kind, caption, position, created_at')
      .eq('ticket_id', id)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    ctx.supabase
      .from('repair_ticket_events')
      .select(
        'id, event_type, notes, amount, new_status, performed_by, occurred_at',
      )
      .eq('ticket_id', id)
      .order('occurred_at', { ascending: false })
      .limit(200),
    ctx.supabase
      .from('repair_time_logs')
      .select('id, technician_id, started_at, stopped_at, notes')
      .eq('ticket_id', id)
      .order('started_at', { ascending: false })
      .limit(50),
  ])

  // Resolve user names for assigned_to + technicians + event performers.
  const userIds = new Set<string>()
  if (ticket.assigned_to) userIds.add(ticket.assigned_to)
  for (const e of events ?? []) if (e.performed_by) userIds.add(e.performed_by)
  for (const l of timeLogs ?? []) if (l.technician_id) userIds.add(l.technician_id)

  let userNames: Record<string, string> = {}
  if (userIds.size > 0) {
    const { data: profiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', Array.from(userIds))
    userNames = Object.fromEntries(
      (profiles ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.email || p.id.slice(0, 8),
      ]),
    )
  }

  // Pick technicians for the assignment dropdown.
  const { data: utRows } = await ctx.supabase
    .from('user_tenants')
    .select('user_id, role')
    .eq('tenant_id', ticket.tenant_id)
    .eq('is_active', true)
  const techIds = (utRows ?? [])
    .filter((u) =>
      ['owner', 'manager', 'pawn_clerk', 'repair_tech', 'chain_admin'].includes(
        u.role,
      ),
    )
    .map((u) => u.user_id)
  let technicianOptions: TechnicianOption[] = []
  if (techIds.length > 0) {
    const { data: techProfiles } = await ctx.supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', techIds)
    technicianOptions = (techProfiles ?? []).map((p) => ({
      id: p.id,
      label: p.full_name?.trim() || p.email || p.id.slice(0, 8),
    }))
  }

  // Inventory items for the part picker (cap 200).
  const { data: invItems } = await ctx.supabase
    .from('inventory_items')
    .select('id, sku, description, cost_basis')
    .eq('tenant_id', ticket.tenant_id)
    .is('deleted_at', null)
    .eq('status', 'available')
    .order('sku', { ascending: false })
    .limit(200)
  const inventoryOptions: InventoryPartChoice[] = (invItems ?? []).map((i) => ({
    id: i.id,
    label: `${i.sku} — ${i.description}`,
    cost_basis: i.cost_basis == null ? null : Number(i.cost_basis),
  }))

  // Sign photo URLs in parallel.
  const photoViews: RepairPhotoView[] = await Promise.all(
    (photos ?? []).map(async (p) => ({
      id: p.id,
      storage_path: p.storage_path,
      signed_url: await getSignedUrl({
        bucket: REPAIR_PHOTOS_BUCKET,
        path: p.storage_path,
        ttlSeconds: 3600,
      }),
      kind: p.kind as RepairPhotoKind,
      caption: p.caption,
      position: p.position,
    })),
  )

  const signatureSignedUrl = ticket.pickup_signature_path
    ? await getSignedUrl({
        bucket: REPAIR_PHOTOS_BUCKET,
        path: ticket.pickup_signature_path,
        ttlSeconds: 3600,
      })
    : null

  const c = (ticket as unknown as {
    customer: {
      id: string
      first_name: string
      last_name: string
      phone: string | null
      email: string | null
    } | null
  }).customer

  const view: RepairTicketView = {
    id: ticket.id,
    tenant_id: ticket.tenant_id,
    customer_id: ticket.customer_id,
    customer_name: c ? `${c.last_name}, ${c.first_name}` : '—',
    customer_phone: c?.phone ?? null,
    customer_email: c?.email ?? null,
    ticket_number: ticket.ticket_number ?? '',
    service_type: ticket.service_type as ServiceType,
    title: ticket.title,
    description: ticket.description,
    item_description: ticket.item_description,
    quote_amount: ticket.quote_amount == null ? null : Number(ticket.quote_amount),
    quote_set_at: ticket.quote_set_at,
    quote_approved_at: ticket.quote_approved_at,
    deposit_amount: Number(ticket.deposit_amount ?? 0),
    deposit_collected_at: ticket.deposit_collected_at,
    balance_due: ticket.balance_due == null ? null : Number(ticket.balance_due),
    paid_amount: Number(ticket.paid_amount ?? 0),
    promised_date: ticket.promised_date,
    completed_at: ticket.completed_at,
    picked_up_at: ticket.picked_up_at,
    pickup_by_name: ticket.pickup_by_name,
    pickup_id_check: ticket.pickup_id_check,
    pickup_signature_signed_url: signatureSignedUrl,
    assigned_to: ticket.assigned_to,
    assigned_to_name: ticket.assigned_to
      ? userNames[ticket.assigned_to] ?? null
      : null,
    status: ticket.status as RepairStatus,
    is_locked: ticket.is_locked,
    notes_internal: ticket.notes_internal,
    source_inventory_item_id: ticket.source_inventory_item_id,
    created_at: ticket.created_at,
  }

  const stoneViews: RepairStoneView[] = (stones ?? []).map((s) => ({
    id: s.id,
    stone_index: s.stone_index,
    stone_type: s.stone_type,
    shape: s.shape,
    size_mm: s.size_mm == null ? null : Number(s.size_mm),
    weight_carats: s.weight_carats == null ? null : Number(s.weight_carats),
    color: s.color,
    clarity: s.clarity,
    mounting_type: s.mounting_type,
    mounting_position: s.mounting_position,
    source: s.source as 'customer_supplied' | 'shop_supplied',
    notes: s.notes,
  }))

  const partViews: RepairPartView[] = (parts ?? []).map((p) => ({
    id: p.id,
    inventory_item_id: p.inventory_item_id,
    description: p.description,
    quantity: Number(p.quantity ?? 0),
    unit_cost: Number(p.unit_cost ?? 0),
    total_cost: Number(p.total_cost ?? 0),
    notes: p.notes,
  }))

  const eventViews: RepairEventView[] = (events ?? []).map((e) => ({
    id: e.id,
    event_type: e.event_type as RepairEventType,
    notes: e.notes,
    amount: e.amount == null ? null : Number(e.amount),
    new_status: e.new_status as RepairStatus | null,
    performed_by_name: e.performed_by ? userNames[e.performed_by] ?? null : null,
    occurred_at: e.occurred_at,
  }))

  const timeLogViews: RepairTimeLogView[] = (timeLogs ?? []).map((l) => ({
    id: l.id,
    technician_id: l.technician_id,
    technician_name: userNames[l.technician_id] ?? null,
    started_at: l.started_at,
    stopped_at: l.stopped_at,
    notes: l.notes,
  }))

  return (
    <RepairTicketDetail
      ticket={view}
      stones={stoneViews}
      parts={partViews}
      photos={photoViews}
      events={eventViews}
      timeLogs={timeLogViews}
      technicians={technicianOptions}
      inventoryOptions={inventoryOptions}
      myUserId={ctx.userId}
    />
  )
}
