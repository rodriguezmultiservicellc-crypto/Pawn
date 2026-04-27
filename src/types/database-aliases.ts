/**
 * Hand-written type aliases for the Pawn schema. These mirror the enums
 * defined in patches/0001-foundation.sql and any subsequent migrations.
 *
 * Why hand-written? `db:types` regenerates src/types/database.ts from the
 * live schema, but the auto-generated file overwrites whole-file. These
 * aliases are imported via `export * from './database-aliases'` at the
 * bottom of database.ts so they survive every regen.
 *
 * RULE: when you add an enum or string-CHECK column to a migration, add it
 * here too.
 */

import type { Database } from './database'

// ── Phase 0 (foundation)

export type TenantRole =
  | 'owner'
  | 'chain_admin'
  | 'manager'
  | 'pawn_clerk'
  | 'repair_tech'
  | 'appraiser'
  | 'client'

export type TenantType = 'chain_hq' | 'shop' | 'standalone'

export type PoliceReportFormat = 'fl_leadsonline'

export type GlobalRole = 'superadmin' | null

export type Language = 'en' | 'es'

/** Per-user permission overrides on top of role defaults. Resolved via
 *  src/lib/permissions.ts (later phase). Open shape with index signature
 *  so empty-init is valid. */
export type PermissionSet = {
  [key: string]: boolean | undefined
}

// ── Phase 1 (customers + inventory) — enum literals

export type IdDocumentType =
  | 'drivers_license'
  | 'state_id'
  | 'passport'
  | 'military_id'
  | 'permanent_resident_card'
  | 'other'

export type CustomerDocKind = 'id_scan' | 'signature'

export type CommPreference = 'email' | 'sms' | 'whatsapp' | 'none'

export type InventoryCategory =
  | 'ring'
  | 'necklace'
  | 'bracelet'
  | 'earrings'
  | 'pendant'
  | 'chain'
  | 'watch'
  | 'coin'
  | 'bullion'
  | 'loose_stone'
  | 'electronics'
  | 'tool'
  | 'instrument'
  | 'other'

export type InventorySource =
  | 'pawn_forfeit'
  | 'bought'
  | 'consigned'
  | 'new_stock'
  | 'repair_excess'
  | 'abandoned_repair'

export type InventoryStatus =
  | 'available'
  | 'held'
  | 'sold'
  | 'scrapped'
  | 'transferred'
  | 'returned'

export type MetalType =
  | 'gold'
  | 'silver'
  | 'platinum'
  | 'palladium'
  | 'rose_gold'
  | 'white_gold'
  | 'tungsten'
  | 'titanium'
  | 'stainless_steel'
  | 'mixed'
  | 'none'
  | 'other'

export type InventoryLocation =
  | 'case'
  | 'safe'
  | 'vault'
  | 'display'
  | 'workshop'
  | 'offsite'
  | 'transfer'

/**
 * Transfer status values used by the v1 transfer UI.
 *
 * The DB enum (`transfer_status`) ships with both the legacy
 * 'in_transit' / 'received' values from 0003 and the new
 * 'accepted' / 'rejected' values added in 0006. The workflow
 * shipped at the UI layer is pending → accepted/rejected/cancelled;
 * the legacy values stay here so SELECTs against historical data
 * still type-check.
 */
export type TransferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'in_transit'
  | 'received'

// ── Phase 1 — Row / Insert / Update shortcuts

export type CustomerRow      = Database['public']['Tables']['customers']['Row']
export type CustomerInsert   = Database['public']['Tables']['customers']['Insert']
export type CustomerUpdate   = Database['public']['Tables']['customers']['Update']

export type CustomerDocumentRow    = Database['public']['Tables']['customer_documents']['Row']
export type CustomerDocumentInsert = Database['public']['Tables']['customer_documents']['Insert']
export type CustomerDocumentUpdate = Database['public']['Tables']['customer_documents']['Update']

export type InventoryItemRow    = Database['public']['Tables']['inventory_items']['Row']
export type InventoryItemInsert = Database['public']['Tables']['inventory_items']['Insert']
export type InventoryItemUpdate = Database['public']['Tables']['inventory_items']['Update']

export type InventoryItemPhotoRow    = Database['public']['Tables']['inventory_item_photos']['Row']
export type InventoryItemPhotoInsert = Database['public']['Tables']['inventory_item_photos']['Insert']
export type InventoryItemPhotoUpdate = Database['public']['Tables']['inventory_item_photos']['Update']

export type InventoryItemStoneRow    = Database['public']['Tables']['inventory_item_stones']['Row']
export type InventoryItemStoneInsert = Database['public']['Tables']['inventory_item_stones']['Insert']
export type InventoryItemStoneUpdate = Database['public']['Tables']['inventory_item_stones']['Update']

export type InventoryTransferRow    = Database['public']['Tables']['inventory_transfers']['Row']
export type InventoryTransferInsert = Database['public']['Tables']['inventory_transfers']['Insert']
export type InventoryTransferUpdate = Database['public']['Tables']['inventory_transfers']['Update']

// ── Phase 2 (pawn loans) — enum literals

export type LoanStatus =
  | 'active'
  | 'extended'
  | 'partial_paid'
  | 'redeemed'
  | 'forfeited'
  | 'voided'

export type LoanEventType =
  | 'issued'
  | 'payment'
  | 'extension'
  | 'redemption'
  | 'forfeiture'
  | 'void'

export type PaymentMethod = 'cash' | 'card' | 'check' | 'other'

// ── Phase 2 — Row / Insert / Update shortcuts.
//
// These reference Database['public']['Tables']['loans'|'loan_collateral_items'|
// 'loan_events']. They will compile only AFTER patches/0005-pawn-loans.sql has
// been applied to the live Supabase project AND `npm run db:types` has been
// run to regenerate src/types/database.ts. Until then, TS will surface "Property
// 'loans' does not exist on type ..." here. That's expected.

export type LoanRow    = Database['public']['Tables']['loans']['Row']
export type LoanInsert = Database['public']['Tables']['loans']['Insert']
export type LoanUpdate = Database['public']['Tables']['loans']['Update']

export type LoanCollateralItemRow    = Database['public']['Tables']['loan_collateral_items']['Row']
export type LoanCollateralItemInsert = Database['public']['Tables']['loan_collateral_items']['Insert']
export type LoanCollateralItemUpdate = Database['public']['Tables']['loan_collateral_items']['Update']

export type LoanEventRow    = Database['public']['Tables']['loan_events']['Row']
export type LoanEventInsert = Database['public']['Tables']['loan_events']['Insert']
export type LoanEventUpdate = Database['public']['Tables']['loan_events']['Update']

export type ComplianceLogRow    = Database['public']['Tables']['compliance_log']['Row']
export type ComplianceLogInsert = Database['public']['Tables']['compliance_log']['Insert']
export type ComplianceLogUpdate = Database['public']['Tables']['compliance_log']['Update']

// ── Phase 3 (repair tickets) — enum literals

export type ServiceType =
  | 'repair'
  | 'stone_setting'
  | 'sizing'
  | 'restring'
  | 'plating'
  | 'engraving'
  | 'custom'

export type RepairStatus =
  | 'intake'
  | 'quoted'
  | 'awaiting_approval'
  | 'in_progress'
  | 'needs_parts'
  | 'ready'
  | 'picked_up'
  | 'abandoned'
  | 'voided'

export type RepairEventType =
  | 'intake'
  | 'quote_set'
  | 'approved'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'parts_needed'
  | 'parts_received'
  | 'completed'
  | 'pickup'
  | 'abandoned_conversion'
  | 'void'
  | 'note'
  | 'photo_added'

export type RepairPhotoKind = 'intake' | 'in_progress' | 'final' | 'reference'

// ── Phase 3 — Row / Insert / Update shortcuts.
//
// These reference Database['public']['Tables']['repair_*']. They will compile
// only AFTER patches/0007-repair-tickets.sql has been applied to the live
// Supabase project AND `npm run db:types` has been run to regenerate
// src/types/database.ts. Until then, TS will surface "Property 'repair_tickets'
// does not exist on type ..." here. That's expected.

export type RepairTicketRow    = Database['public']['Tables']['repair_tickets']['Row']
export type RepairTicketInsert = Database['public']['Tables']['repair_tickets']['Insert']
export type RepairTicketUpdate = Database['public']['Tables']['repair_tickets']['Update']

export type RepairTicketStoneRow    = Database['public']['Tables']['repair_ticket_stones']['Row']
export type RepairTicketStoneInsert = Database['public']['Tables']['repair_ticket_stones']['Insert']
export type RepairTicketStoneUpdate = Database['public']['Tables']['repair_ticket_stones']['Update']

export type RepairTicketItemRow    = Database['public']['Tables']['repair_ticket_items']['Row']
export type RepairTicketItemInsert = Database['public']['Tables']['repair_ticket_items']['Insert']
export type RepairTicketItemUpdate = Database['public']['Tables']['repair_ticket_items']['Update']

export type RepairTicketEventRow    = Database['public']['Tables']['repair_ticket_events']['Row']
export type RepairTicketEventInsert = Database['public']['Tables']['repair_ticket_events']['Insert']
export type RepairTicketEventUpdate = Database['public']['Tables']['repair_ticket_events']['Update']

export type RepairTicketPhotoRow    = Database['public']['Tables']['repair_ticket_photos']['Row']
export type RepairTicketPhotoInsert = Database['public']['Tables']['repair_ticket_photos']['Insert']
export type RepairTicketPhotoUpdate = Database['public']['Tables']['repair_ticket_photos']['Update']

export type RepairTimeLogRow    = Database['public']['Tables']['repair_time_logs']['Row']
export type RepairTimeLogInsert = Database['public']['Tables']['repair_time_logs']['Insert']
export type RepairTimeLogUpdate = Database['public']['Tables']['repair_time_logs']['Update']

// ── Phase 4 (retail / POS) — enum literals

export type SaleStatus =
  | 'open'
  | 'completed'
  | 'voided'
  | 'partial_returned'
  | 'fully_returned'

export type SaleKind = 'retail' | 'layaway'

export type ReturnStatus = 'issued' | 'voided'

export type LayawayStatus =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'defaulted'

export type RegisterSessionStatus = 'open' | 'closed' | 'reconciled'

export type CardPresentStatus =
  | 'not_used'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'

export type LayawayScheduleKind =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'custom'

// ── Phase 4 — Row / Insert / Update shortcuts.
//
// These reference Database['public']['Tables']['sales'|'sale_items'|...]. They
// will compile only AFTER patches/0008-retail-pos.sql has been applied to the
// live Supabase project AND `npm run db:types` has been run to regenerate
// src/types/database.ts. Until then, TS will surface "Property 'sales' does
// not exist on type ..." here. That's expected.

export type RegisterSessionRow    = Database['public']['Tables']['register_sessions']['Row']
export type RegisterSessionInsert = Database['public']['Tables']['register_sessions']['Insert']
export type RegisterSessionUpdate = Database['public']['Tables']['register_sessions']['Update']

export type SaleRow    = Database['public']['Tables']['sales']['Row']
export type SaleInsert = Database['public']['Tables']['sales']['Insert']
export type SaleUpdate = Database['public']['Tables']['sales']['Update']

export type SaleItemRow    = Database['public']['Tables']['sale_items']['Row']
export type SaleItemInsert = Database['public']['Tables']['sale_items']['Insert']
export type SaleItemUpdate = Database['public']['Tables']['sale_items']['Update']

export type SalePaymentRow    = Database['public']['Tables']['sale_payments']['Row']
export type SalePaymentInsert = Database['public']['Tables']['sale_payments']['Insert']
export type SalePaymentUpdate = Database['public']['Tables']['sale_payments']['Update']

export type ReturnRow    = Database['public']['Tables']['returns']['Row']
export type ReturnInsert = Database['public']['Tables']['returns']['Insert']
export type ReturnUpdate = Database['public']['Tables']['returns']['Update']

export type ReturnItemRow    = Database['public']['Tables']['return_items']['Row']
export type ReturnItemInsert = Database['public']['Tables']['return_items']['Insert']
export type ReturnItemUpdate = Database['public']['Tables']['return_items']['Update']

export type LayawayRow    = Database['public']['Tables']['layaways']['Row']
export type LayawayInsert = Database['public']['Tables']['layaways']['Insert']
export type LayawayUpdate = Database['public']['Tables']['layaways']['Update']

export type LayawayPaymentRow    = Database['public']['Tables']['layaway_payments']['Row']
export type LayawayPaymentInsert = Database['public']['Tables']['layaway_payments']['Insert']
export type LayawayPaymentUpdate = Database['public']['Tables']['layaway_payments']['Update']

// ── Phase 5 (customer portal) — stripe_payment_links + customers.auth_user_id
//
// Until 0009 is applied + db-types regenerated, the new table doesn't appear
// in Database['public']['Tables']. We hand-roll the row shape here so the
// portal action / webhook code type-checks. The operator regenerates
// database.ts at merge time and we can collapse these aliases to the
// generated Database['public']['Tables']['stripe_payment_links'] form.

export type StripePaymentLinkKind = 'loan_payoff' | 'layaway_payment'

export type StripePaymentLinkStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'

export type StripePaymentLinkRow = {
  id: string
  tenant_id: string
  source_kind: StripePaymentLinkKind
  source_id: string
  customer_id: string
  stripe_session_id: string
  checkout_url: string | null
  stripe_account_id: string | null
  stripe_payment_intent_id: string | null
  amount: number | string
  currency: string
  status: StripePaymentLinkStatus
  created_at: string
  updated_at: string
  paid_at: string | null
}

export type StripePaymentLinkInsert = {
  id?: string
  tenant_id: string
  source_kind: StripePaymentLinkKind
  source_id: string
  customer_id: string
  stripe_session_id: string
  checkout_url?: string | null
  stripe_account_id?: string | null
  stripe_payment_intent_id?: string | null
  amount: number | string
  currency?: string
  status?: StripePaymentLinkStatus
  created_at?: string
  updated_at?: string
  paid_at?: string | null
}

export type StripePaymentLinkUpdate = Partial<StripePaymentLinkInsert>
