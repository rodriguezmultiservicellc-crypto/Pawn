import { createAdminClient } from './supabase/admin'
import type { Database } from '@/types/database'

type AuditChanges = Database['public']['Tables']['audit_log']['Insert']['changes']

/**
 * Audit-log writer. Every mutation on a tenant-scoped table goes through
 * here so we have a complete, immutable history (audit_log has a write-
 * once trigger from 0001-foundation.sql — no UPDATE, no DELETE).
 *
 * RLS on audit_log defines a staff SELECT policy but no INSERT policy,
 * so client-scoped inserts would be blocked. We always go through the
 * admin (service-role) client. Callers MUST verify staff/role access
 * before invoking — this helper only writes; it does not gate.
 *
 * Failures are swallowed silently. An audit-log insert that fails (e.g.,
 * transient network error) MUST NOT break the user-facing action. We log
 * to console for diagnostics.
 */

export type AuditAction =
  // Generic CRUD
  | 'create'
  | 'update'
  | 'soft_delete'
  // Customer-specific
  | 'ban'
  | 'unban'
  | 'doc_upload'
  | 'doc_delete'
  // Inventory-specific
  | 'photo_upload'
  | 'photo_delete'
  | 'photo_set_primary'
  | 'stone_add'
  | 'stone_delete'
  // Transfer-specific
  | 'transfer_request'
  | 'transfer_accept'
  | 'transfer_reject'
  | 'transfer_cancel'
  // Repair-specific
  | 'quote_set'
  | 'approve_quote'
  | 'collect_deposit'
  | 'start_work'
  | 'mark_needs_parts'
  | 'parts_received'
  | 'mark_complete'
  | 'record_pickup'
  | 'mark_abandoned'
  | 'void'
  | 'assign_technician'
  | 'add_note'
  | 'add_part'
  | 'remove_part'
  | 'add_stone_repair'
  | 'remove_stone_repair'
  | 'photo_upload_repair'
  | 'photo_delete_repair'
  | 'photo_caption'
  | 'timer_start'
  | 'timer_stop'
  | 'abandoned_to_inventory'

export async function logAudit(args: {
  tenantId: string
  userId: string
  action: AuditAction
  tableName: string
  recordId: string
  changes?: Record<string, unknown> | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    // Supabase types changes as the Json union; Record<string, unknown> is
    // too loose. JSON-roundtrip narrows it without runtime cost (the values
    // we pass in are always JSON-serializable already).
    const changes: AuditChanges =
      args.changes == null
        ? null
        : (JSON.parse(JSON.stringify(args.changes)) as AuditChanges)
    const { error } = await admin.from('audit_log').insert({
      tenant_id: args.tenantId,
      user_id: args.userId,
      action: args.action,
      table_name: args.tableName,
      record_id: args.recordId,
      changes,
    })
    if (error) {
      console.error('[audit] insert failed', error.message, {
        action: args.action,
        table: args.tableName,
        record: args.recordId,
      })
    }
  } catch (err) {
    console.error('[audit] unexpected error', err)
  }
}

