'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCtx } from '@/lib/supabase/ctx'
import { requireRoleInTenant } from '@/lib/supabase/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantSecret, isSecretConfigured } from '@/lib/secrets/vault'
import { logAudit } from '@/lib/audit'
import {
  cancelOrder,
  createOrder,
  orocutCallbackUrl,
  type CreateOrderPayload,
} from '@/lib/orocut/client'
import { isOpenLaserStatus, OPEN_LASER_STATUSES, type LaserOrderStatus } from '@/lib/orocut/status'
import type { HistoryEntry } from '@/lib/orocut/merge'
import {
  applyRemoteStatus,
  LASER_ORDER_SYNC_COLUMNS,
  syncLaserOrder,
  type LaserOrderSyncRow,
} from '@/lib/orocut/sync'
import { laserOrderIdSchema, laserOrderSendSchema } from '@/lib/validations/laser-order'
import type { Json } from '@/types/database'
import type { TenantRole } from '@/types/database-aliases'

/**
 * Laser nameplate orders — server actions (patches/0070). Async functions
 * only in this file (Next 16 'use server' rule; see lib/bench/calculators.ts).
 *
 * Send → POST to orocut.com → one laser_orders row (only once orocut.com
 * answered with an order_id). Cancel → POST /cancel → row cancelled.
 * Refresh → GET → merge. The webhook and the cron do the same merge.
 */

export type LaserActionResult = {
  ok?: boolean
  /** Translated through t.repair.laser.errors[code] when it matches. */
  error?: string
  /** Free-text detail for 'remote' / 'cancel_refused'. */
  detail?: string
  fieldErrors?: Record<string, string>
  status?: LaserOrderStatus
}

const STAFF_REPAIR_ROLES: ReadonlyArray<TenantRole> = [
  'owner',
  'manager',
  'pawn_clerk',
  'repair_tech',
  'chain_admin',
]

async function ticketScope(ticketId: string) {
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: ticket } = await ctx.supabase
    .from('repair_tickets')
    .select(
      `id, tenant_id, ticket_number, status, promised_date, title,
       customer:customers(first_name, last_name)`,
    )
    .eq('id', ticketId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ticket) redirect('/repair')
  const { supabase, userId } = await requireRoleInTenant(ticket.tenant_id, STAFF_REPAIR_ROLES)
  const c = (ticket as unknown as { customer: { first_name: string; last_name: string } | null }).customer
  return {
    ticket: {
      id: ticket.id,
      tenant_id: ticket.tenant_id,
      ticket_number: ticket.ticket_number ?? '',
      status: ticket.status,
      promised_date: ticket.promised_date,
      title: ticket.title,
      customer_name: c ? `${c.first_name} ${c.last_name}`.trim() : null,
    },
    supabase,
    userId,
    tenantId: ticket.tenant_id,
  }
}

function isClosedTicket(status: string): boolean {
  return status === 'picked_up' || status === 'abandoned' || status === 'voided'
}

function mapFailure(kind: 'unauthorized' | 'network' | 'remote' | 'invalid', detail: string): LaserActionResult {
  if (kind === 'unauthorized') return { error: 'unauthorized_token' }
  if (kind === 'network') return { error: 'network' }
  return { error: 'remote', detail }
}

// ── Send ──────────────────────────────────────────────────────────────────

export async function sendToLaserAction(formData: FormData): Promise<LaserActionResult> {
  const raw: Record<string, FormDataEntryValue | null> = {}
  for (const k of [
    'ticket_id',
    'text',
    'text2',
    'style',
    'quantity',
    'metal',
    'thickness_mm',
    'chain_length_in',
    'height_mm',
    'customer_name',
    'due_at',
    'notes',
    'picture_url',
  ]) {
    raw[k] = formData.get(k)
  }
  const parsed = laserOrderSendSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message
    }
    return { error: 'invalid', fieldErrors }
  }
  const v = parsed.data

  const { ticket, supabase, userId, tenantId } = await ticketScope(v.ticket_id)
  if (isClosedTicket(ticket.status)) return { error: 'ticket_closed' }

  const { data: open } = await supabase
    .from('laser_orders')
    .select('id')
    .eq('repair_ticket_id', ticket.id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .in('status', [...OPEN_LASER_STATUSES])
    .limit(1)
  if ((open ?? []).length > 0) return { error: 'already_open' }

  const token = await getTenantSecret(tenantId, 'orocut_order_token')
  if (!token) return { error: 'not_configured' }

  const externalId = ticket.ticket_number.slice(0, 64)
  if (!externalId) return { error: 'invalid' }

  // due_at: the promised date at noon UTC — same calendar day in every US
  // zone; orocut.com only shows and sorts by it.
  const dueAt = v.due_at ? `${v.due_at}T12:00:00.000Z` : undefined
  // The webhook is only useful when we hold the signing secret issued with
  // the token; without it every delivery would be refused, so ask for none
  // and let the poller carry the status.
  const callback = (await isSecretConfigured(tenantId, 'orocut_webhook_secret'))
    ? orocutCallbackUrl()
    : null

  const payload: CreateOrderPayload = {
    external_id: externalId,
    text: v.text,
    ...(v.text2 ? { text2: v.text2 } : {}),
    ...(v.style ? { style: v.style } : {}),
    quantity: v.quantity,
    ...(v.metal ? { metal: v.metal } : {}),
    ...(v.thickness_mm != null ? { thickness_mm: v.thickness_mm } : {}),
    ...(v.chain_length_in != null ? { chain_length_in: v.chain_length_in } : {}),
    ...(v.height_mm != null ? { height_mm: v.height_mm } : {}),
    ...(v.customer_name ? { customer_name: v.customer_name } : {}),
    ...(dueAt ? { due_at: dueAt } : {}),
    ...(v.notes ? { notes: v.notes } : {}),
    ...(v.picture_url ? { picture_url: v.picture_url } : {}),
    ...(callback ? { callback_url: callback } : {}),
  }

  const res = await createOrder(token, payload)
  if (!res.ok) return mapFailure(res.kind, res.detail)

  const now = new Date().toISOString()
  const admin = createAdminClient()

  if (res.conflict) {
    // orocut.com already holds an open order with this ticket number. If
    // we know it, the panel is simply stale; if we don't (sent before a
    // crash, or from elsewhere), adopt it below so the shop can see it.
    const { data: known } = await admin
      .from('laser_orders')
      .select('id, status')
      .eq('orocut_order_id', res.orderId)
      .maybeSingle()
    if (known) {
      revalidatePath(`/repair/${ticket.id}`)
      return { error: 'already_open', status: known.status }
    }
  }

  const history: HistoryEntry[] = [{ status: 'new', at: now, via: 'app', by: userId }]
  const status: LaserOrderStatus = res.status ?? 'new'
  const { data: inserted, error: insErr } = await supabase
    .from('laser_orders')
    .insert({
      tenant_id: tenantId,
      repair_ticket_id: ticket.id,
      external_id: externalId,
      orocut_order_id: res.orderId,
      status,
      text: v.text,
      text2: v.text2,
      style: v.style,
      quantity: v.quantity,
      metal: v.metal,
      thickness_mm: v.thickness_mm,
      chain_length_in: v.chain_length_in,
      height_mm: v.height_mm,
      customer_name: v.customer_name,
      due_at: dueAt ?? null,
      notes: v.notes,
      picture_url: v.picture_url,
      status_history: history as unknown as Json,
      remote_updated_at: now,
      last_synced_at: now,
      sent_by: userId,
      sent_at: now,
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    const msg = insErr?.message ?? 'insert_failed'
    if (msg.includes('uq_laser_orders_open_per_ticket')) return { error: 'already_open' }
    return { error: msg }
  }

  await logAudit({
    tenantId,
    userId,
    action: 'laser_order_send',
    tableName: 'laser_orders',
    recordId: inserted.id,
    changes: {
      repair_ticket_id: ticket.id,
      external_id: externalId,
      orocut_order_id: res.orderId,
      adopted_existing: res.conflict,
      payload: { ...payload, callback_url: callback ? '(set)' : null },
    },
  })

  await supabase.from('repair_ticket_events').insert({
    ticket_id: ticket.id,
    tenant_id: tenantId,
    event_type: 'note',
    notes: `Laser: sent "${v.text}"${v.style ? ` · ${v.style}` : ''}${v.quantity > 1 ? ` ×${v.quantity}` : ''} (order ${externalId})`,
    performed_by: userId,
  })

  // If orocut.com already had it (409), pick up its real status right away.
  if (res.conflict) {
    const { data: row } = await admin
      .from('laser_orders')
      .select(LASER_ORDER_SYNC_COLUMNS)
      .eq('id', inserted.id)
      .maybeSingle()
    if (row) await syncLaserOrder(admin, row as LaserOrderSyncRow, token)
  }

  revalidatePath(`/repair/${ticket.id}`)
  revalidatePath('/settings/integrations')
  return { ok: true, status }
}

// ── Cancel / Refresh ──────────────────────────────────────────────────────

async function orderScope(formData: FormData) {
  const parsed = laserOrderIdSchema.safeParse({ order_id: formData.get('order_id') })
  if (!parsed.success) return { error: 'invalid' as const }
  const ctx = await getCtx()
  if (!ctx) redirect('/login')
  const { data: row } = await ctx.supabase
    .from('laser_orders')
    .select(LASER_ORDER_SYNC_COLUMNS)
    .eq('id', parsed.data.order_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!row) return { error: 'not_found' as const }
  const { userId } = await requireRoleInTenant(row.tenant_id, STAFF_REPAIR_ROLES)
  return { row: row as LaserOrderSyncRow, userId }
}

export async function cancelLaserOrderAction(formData: FormData): Promise<LaserActionResult> {
  const s = await orderScope(formData)
  if ('error' in s) return { error: s.error }
  const { row, userId } = s
  if (!isOpenLaserStatus(row.status)) return { error: 'not_open', status: row.status }

  const token = await getTenantSecret(row.tenant_id, 'orocut_order_token')
  if (!token) return { error: 'not_configured' }

  const admin = createAdminClient()
  const res = await cancelOrder(token, row.orocut_order_id)
  if (!res.ok) return mapFailure(res.kind, res.detail)

  if (res.refused) {
    // Already final over there — take the server's word for it.
    const synced = await syncLaserOrder(admin, row, token)
    revalidatePath(`/repair/${row.repair_ticket_id}`)
    const status = synced.ok ? synced.status : res.status ?? row.status
    return { error: 'cancel_refused', detail: status, status }
  }

  const applied = await applyRemoteStatus(
    admin,
    row,
    { status: 'cancelled', at: new Date().toISOString(), by: userId },
    'app',
    userId,
  )
  if (!applied.ok) return { error: applied.error }

  revalidatePath(`/repair/${row.repair_ticket_id}`)
  revalidatePath('/settings/integrations')
  return { ok: true, status: 'cancelled' }
}

export async function refreshLaserOrderAction(formData: FormData): Promise<LaserActionResult> {
  const s = await orderScope(formData)
  if ('error' in s) return { error: s.error }
  const { row } = s
  if (!isOpenLaserStatus(row.status)) return { ok: true, status: row.status }

  const admin = createAdminClient()
  const synced = await syncLaserOrder(admin, row)
  if (!synced.ok) {
    return {
      error: synced.error.startsWith('remote: ') ? 'remote' : synced.error,
      detail: synced.error.startsWith('remote: ') ? synced.error.slice(8) : undefined,
    }
  }
  if (synced.changed) {
    revalidatePath(`/repair/${row.repair_ticket_id}`)
    revalidatePath('/settings/integrations')
  }
  return { ok: true, status: synced.status }
}
