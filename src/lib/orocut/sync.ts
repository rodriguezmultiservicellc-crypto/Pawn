import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { logAudit } from '@/lib/audit'
import { getTenantSecret } from '@/lib/secrets/vault'
import { getOrder } from './client'
import {
  mergeRemoteStatus,
  type HistoryVia,
  type LaserStatusPatch,
  type RemoteObservation,
} from './merge'
import type { LaserOrderStatus } from './status'

/**
 * Applying a remote status to a laser_orders row — shared by the webhook
 * (push), the poller (cron + the panel's Refresh) and the Cancel action.
 * Every status change writes an audit row and a note on the ticket's
 * timeline so the bench sees "Cut on the laser" without opening the panel.
 */

export type LaserOrderSyncRow = Pick<
  Database['public']['Tables']['laser_orders']['Row'],
  | 'id'
  | 'tenant_id'
  | 'repair_ticket_id'
  | 'external_id'
  | 'orocut_order_id'
  | 'status'
  | 'remote_updated_at'
  | 'cut_count'
  | 'cut_details'
  | 'status_history'
>

export const LASER_ORDER_SYNC_COLUMNS =
  'id, tenant_id, repair_ticket_id, external_id, orocut_order_id, status, remote_updated_at, cut_count, cut_details, status_history'

type Admin = SupabaseClient<Database>

function toUpdate(patch: LaserStatusPatch): Database['public']['Tables']['laser_orders']['Update'] {
  const u: Database['public']['Tables']['laser_orders']['Update'] = {
    last_synced_at: patch.last_synced_at,
    last_sync_error: patch.last_sync_error,
  }
  if (patch.status !== undefined) u.status = patch.status
  if (patch.status_history !== undefined) u.status_history = patch.status_history as unknown as Json
  if (patch.cut_count !== undefined) u.cut_count = patch.cut_count
  if (patch.cut_details !== undefined) u.cut_details = patch.cut_details as unknown as Json
  if (patch.reject_reason !== undefined) u.reject_reason = patch.reject_reason
  if (patch.finished_at !== undefined) u.finished_at = patch.finished_at
  if (patch.remote_updated_at !== undefined) u.remote_updated_at = patch.remote_updated_at
  return u
}

export type ApplyResult =
  | { ok: true; changed: boolean; status: LaserOrderStatus }
  | { ok: false; error: string }

/**
 * Merge one remote observation into the row and persist it. `userId` is
 * the acting staff member for an app-side change (Cancel), null for the
 * webhook and the poller.
 */
export async function applyRemoteStatus(
  admin: Admin,
  row: LaserOrderSyncRow,
  remote: RemoteObservation,
  via: HistoryVia,
  userId: string | null = null,
): Promise<ApplyResult> {
  const merged = mergeRemoteStatus(row, remote, via)
  const { error } = await admin.from('laser_orders').update(toUpdate(merged.patch)).eq('id', row.id)
  if (error) return { ok: false, error: error.message }
  if (!merged.changed) return { ok: true, changed: false, status: row.status }

  await logAudit({
    tenantId: row.tenant_id,
    userId,
    action: via === 'app' && merged.to === 'cancelled' ? 'laser_order_cancel' : 'laser_order_status',
    tableName: 'laser_orders',
    recordId: row.id,
    changes: {
      external_id: row.external_id,
      orocut_order_id: row.orocut_order_id,
      from: merged.from,
      to: merged.to,
      via,
      by: remote.by ?? null,
      reason: remote.reason ?? null,
      details: remote.details ?? null,
      at: remote.at,
    },
  })

  await admin.from('repair_ticket_events').insert({
    ticket_id: row.repair_ticket_id,
    tenant_id: row.tenant_id,
    event_type: 'note',
    notes: timelineNote(merged.to, remote),
    performed_by: userId,
  })

  return { ok: true, changed: true, status: merged.to }
}

function timelineNote(status: LaserOrderStatus, remote: RemoteObservation): string {
  const who = remote.by ? ` (${remote.by})` : ''
  switch (status) {
    case 'received':
      return `Laser: order received at the laser PC${who}`
    case 'cut': {
      const d = remote.details
      const size = d?.width_mm != null && d?.height_mm != null ? ` ${d.width_mm}×${d.height_mm} mm` : ''
      const mins = d?.minutes != null ? ` in ${d.minutes} min` : ''
      return `Laser: cut${size}${mins}${who}`
    }
    case 'done':
      return `Laser: done${who}`
    case 'rejected':
      return `Laser: rejected${who}${remote.reason ? ` — ${remote.reason}` : ''}`
    case 'cancelled':
      return 'Laser: order cancelled'
    default:
      return `Laser: ${status}`
  }
}

/**
 * Pull the order from orocut.com and merge it. Errors are written to
 * `last_sync_error` (and returned), never thrown — a dead orocut.com must
 * not take a ticket page or the cron down with it.
 */
export async function syncLaserOrder(
  admin: Admin,
  row: LaserOrderSyncRow,
  token?: string | null,
): Promise<ApplyResult> {
  const now = new Date().toISOString()
  const t = token ?? (await getTenantSecret(row.tenant_id, 'orocut_order_token'))
  if (!t) {
    await admin
      .from('laser_orders')
      .update({ last_synced_at: now, last_sync_error: 'not_configured' })
      .eq('id', row.id)
    return { ok: false, error: 'not_configured' }
  }

  const res = await getOrder(t, row.orocut_order_id)
  if (!res.ok) {
    const err = res.kind === 'unauthorized' ? 'unauthorized_token' : res.kind === 'network' ? 'network' : `remote: ${res.detail}`
    await admin
      .from('laser_orders')
      .update({ last_synced_at: now, last_sync_error: err.slice(0, 500) })
      .eq('id', row.id)
    return { ok: false, error: err }
  }

  const o = res.order
  // Prefer the history's latest entry for "who"/"when"; fall back to the
  // document's updated_at (or now, which the merge treats as newest).
  const latest = o.history.length > 0 ? o.history[o.history.length - 1] : null
  const observation: RemoteObservation = {
    status: o.status,
    at: (latest && latest.status === o.status ? latest.at : null) ?? o.updated_at ?? now,
    by: latest && latest.status === o.status ? latest.by ?? null : null,
    reason: o.reason ?? (latest?.status === o.status ? latest.reason ?? null : null),
    details: o.details ?? (latest?.status === o.status ? latest.details ?? null : null),
  }
  return applyRemoteStatus(admin, row, observation, 'poll', null)
}
