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
  | 'claim_ticket'
  | 'send_to_qa'
  | 'approve_qa'
  | 'return_from_qa'
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
  // POS-specific
  | 'sale_create'
  | 'sale_complete'
  | 'sale_void'
  | 'sale_payment_add'
  | 'return_create'
  | 'return_void'
  | 'layaway_create'
  | 'layaway_payment_add'
  | 'layaway_cancel'
  | 'layaway_complete'
  | 'register_open'
  | 'register_close'
  | 'register_reconcile'
  | 'card_present_succeeded'
  // Reports / compliance
  | 'export'
  // Buy-outright (gold-buying / wholesale buy-side)
  | 'buy_outright'
  // SaaS billing (platform-side)
  | 'tenant_plan_change'
  // Appraisal-specific
  | 'appraisal_create'
  | 'appraisal_update'
  | 'appraisal_finalize'
  | 'appraisal_void'
  | 'appraisal_print'
  | 'appraisal_photo_upload'
  | 'appraisal_photo_delete'
  | 'appraisal_stone_upsert'
  | 'appraisal_stone_delete'
  // Spot prices
  | 'spot_price_refresh'
  | 'spot_price_override_change'
  // Google Reviews (Phase 10 A)
  | 'google_reviews_refresh'
  // eBay listing publisher (Phase 10, Path B)
  | 'ebay_oauth_connected'
  | 'ebay_oauth_disconnected'
  | 'ebay_listing_create'
  | 'ebay_listing_publish'
  | 'ebay_listing_update'
  | 'ebay_listing_end'
  | 'ebay_listing_sync'
  // Customer portal invites (Phase 5 onboarding self-link flow)
  | 'portal_invite_sent'
  | 'portal_invites_revoked'
  | 'portal_invite_consumed'
  // Email campaigns (Phase 10 A)
  | 'email_campaign_create'
  | 'email_campaign_update'
  | 'email_campaign_schedule'
  | 'email_campaign_cancel'
  | 'email_campaign_dispatch'
  | 'email_campaign_unsubscribe'
  | 'email_campaign_bounce'
  | 'email_campaign_complaint'

export async function logAudit(args: {
  tenantId: string
  /** null is allowed for system-initiated events (Stripe webhooks, cron
   *  jobs, etc.) where no human user is acting. The audit_log column
   *  itself is nullable. */
  userId: string | null
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

