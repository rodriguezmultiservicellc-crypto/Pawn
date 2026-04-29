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
  | 'assigned'
  | 'in_progress'
  | 'needs_parts'
  | 'tech_qa'
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
  | 'assigned_to_tech'
  | 'claimed_by_tech'
  | 'qa_started'
  | 'qa_completed'
  | 'qa_returned'

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

// ── Phase 5 (customer portal) — stripe_payment_links
// Generated types pulled directly from Database['public']['Tables'].
// Kind/Status remain as authoring narrowings since they're TEXT+CHECK
// columns (no PG enum); the table Row exposes them as plain `string`.

export type StripePaymentLinkKind = 'loan_payoff' | 'layaway_payment'
export type StripePaymentLinkStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'

export type StripePaymentLinkRow    = Database['public']['Tables']['stripe_payment_links']['Row']
export type StripePaymentLinkInsert = Database['public']['Tables']['stripe_payment_links']['Insert']
export type StripePaymentLinkUpdate = Database['public']['Tables']['stripe_payment_links']['Update']

// ── Phase 6 (communications) — message_templates + message_log + settings comms
// All collapsed to generated types. Enums route through Database['public']['Enums'].

export type MessageKind    = Database['public']['Enums']['message_kind']
export type MessageChannel = Database['public']['Enums']['message_channel']
export type MessageStatus  = Database['public']['Enums']['message_status']

export type MessageTemplateRow    = Database['public']['Tables']['message_templates']['Row']
export type MessageTemplateInsert = Database['public']['Tables']['message_templates']['Insert']
export type MessageTemplateUpdate = Database['public']['Tables']['message_templates']['Update']

export type MessageLogRow    = Database['public']['Tables']['message_log']['Row']
export type MessageLogInsert = Database['public']['Tables']['message_log']['Insert']
export type MessageLogUpdate = Database['public']['Tables']['message_log']['Update']

/** Narrow projection over the comms-relevant settings columns. */
export type SettingsCommsColumns = Pick<
  Database['public']['Tables']['settings']['Row'],
  | 'twilio_account_sid'
  | 'twilio_auth_token'
  | 'twilio_phone_number'
  | 'twilio_whatsapp_number'
  | 'twilio_messaging_service_sid'
  | 'twilio_sms_from'
  | 'twilio_whatsapp_from'
  | 'resend_api_key'
  | 'email_from'
  | 'resend_from_email'
  | 'resend_from_name'
>

// ── Phase 9 (Path B — appraised valuation) — enum literals
//
// These reference patches/0014-appraisals.sql. They will compile only AFTER
// 0014 is applied to the live Supabase project AND `npm run db:types` has been
// run to regenerate src/types/database.ts. Until then, TS will surface
// "Property 'appraisals' does not exist on type ..." here. That's expected.

export type AppraisalStatus = 'draft' | 'finalized' | 'voided'

export type AppraisalPurpose =
  | 'insurance'
  | 'estate'
  | 'sale'
  | 'pawn_intake'
  | 'collateral_review'
  | 'customer_request'

export type AppraisalPhotoKind =
  | 'front'
  | 'back'
  | 'detail'
  | 'serial'
  | 'cert'
  | 'reference'

// Row / Insert / Update shortcuts — depend on 0014 + db:types regen.
// Until then we publish a hand-rolled placeholder so action/page code can
// import `AppraisalUpdate` etc. without forcing a brittle cast everywhere.
// On db:types regen, swap these to the auto-generated table types:
//   export type AppraisalRow = Database['public']['Tables']['appraisals']['Row']
//   …etc.

type _AppraisalsAvailable = Database['public']['Tables'] extends { appraisals: infer A }
  ? A
  : null

export type AppraisalRow = _AppraisalsAvailable extends { Row: infer R }
  ? R
  : {
      id: string
      tenant_id: string
      appraisal_number: string | null
      customer_id: string | null
      inventory_item_id: string | null
      item_description: string
      metal_type: string | null
      karat: number | null
      weight_grams: number | null
      purpose: string
      appraised_value: number | string
      replacement_value: number | string | null
      valuation_method: string | null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      comparable_data: any
      notes: string | null
      appraiser_user_id: string
      appraiser_signature_storage_path: string | null
      customer_signature_storage_path: string | null
      valid_from: string
      valid_until: string | null
      status: AppraisalStatus
      finalized_at: string | null
      finalized_by: string | null
      voided_at: string | null
      voided_by: string | null
      void_reason: string | null
      is_printed: boolean
      printed_at: string | null
      created_at: string
      updated_at: string
      deleted_at: string | null
      created_by: string | null
      updated_by: string | null
    }

export type AppraisalInsert = Partial<AppraisalRow> & {
  tenant_id: string
  item_description: string
  purpose: AppraisalPurpose
  appraised_value: number | string
  appraiser_user_id: string
  valid_from: string
}

export type AppraisalUpdate = Partial<AppraisalRow>

type _AppraisalStonesAvailable = Database['public']['Tables'] extends { appraisal_stones: infer A }
  ? A
  : null

export type AppraisalStoneRow = _AppraisalStonesAvailable extends { Row: infer R }
  ? R
  : {
      id: string
      appraisal_id: string
      tenant_id: string
      position: number
      count: number
      type: string | null
      cut: string | null
      est_carat: number | null
      color: string | null
      clarity: string | null
      certified: boolean
      cert_lab: string | null
      cert_number: string | null
      notes: string | null
      created_at: string
      deleted_at: string | null
    }

export type AppraisalStoneInsert = Partial<AppraisalStoneRow> & {
  appraisal_id: string
  tenant_id: string
}

export type AppraisalStoneUpdate = Partial<AppraisalStoneRow>

type _AppraisalPhotosAvailable = Database['public']['Tables'] extends { appraisal_photos: infer A }
  ? A
  : null

export type AppraisalPhotoRow = _AppraisalPhotosAvailable extends { Row: infer R }
  ? R
  : {
      id: string
      appraisal_id: string
      tenant_id: string
      storage_path: string
      kind: AppraisalPhotoKind
      caption: string | null
      position: number
      created_by: string | null
      created_at: string
      deleted_at: string | null
    }

export type AppraisalPhotoInsert = Partial<AppraisalPhotoRow> & {
  appraisal_id: string
  tenant_id: string
  storage_path: string
  kind: AppraisalPhotoKind
}

export type AppraisalPhotoUpdate = Partial<AppraisalPhotoRow>

// ── Phase 9 (Path B) — bullion spot-price feed.
//
// patches/0013-spot-prices.sql introduces the metal_purity enum and the
// spot_prices + spot_price_overrides tables. The DB types regen happens at
// merge time; until then we maintain hand-rolled Row/Insert/Update shapes
// here so the rest of the spot-price code base type-checks.

export type MetalPurity =
  | 'pure_24k'
  | '22k'
  | '18k'
  | '14k'
  | '10k'
  | 'sterling_925'
  | 'platinum_950'
  | 'palladium_950'
  | 'fine'

/** spot_prices row shape (matches patches/0013-spot-prices.sql). */
export type SpotPriceRow = {
  id: string
  metal_type: MetalType
  purity: MetalPurity
  /** numeric(18,4) — comes back as string from supabase-js. */
  price_per_gram: string
  /** numeric(18,4) — comes back as string from supabase-js. */
  price_per_troy_oz: string
  currency: string
  source: string
  source_request_id: string | null
  fetched_at: string
  created_at: string
}

export type SpotPriceInsert = {
  id?: string
  metal_type: MetalType
  purity: MetalPurity
  price_per_gram: string | number
  price_per_troy_oz: string | number
  currency?: string
  source: string
  source_request_id?: string | null
  fetched_at: string
  created_at?: string
}

export type SpotPriceOverrideRow = {
  id: string
  tenant_id: string
  metal_type: MetalType
  purity: MetalPurity
  /** numeric(6,4) — comes back as string from supabase-js. */
  multiplier: string
  updated_by: string | null
  updated_at: string
  created_at: string
}

export type SpotPriceOverrideInsert = {
  id?: string
  tenant_id: string
  metal_type: MetalType
  purity: MetalPurity
  multiplier: string | number
  updated_by?: string | null
  updated_at?: string
  created_at?: string
}

export type SpotPriceOverrideUpdate = Partial<SpotPriceOverrideInsert>

// ── Phase 10 (Path B) — eBay listing publisher
//
// SCAFFOLD ONLY — patches/0015-ebay-listings.sql defines the underlying
// tables but is NOT applied to the live Supabase project yet (operator will
// apply at merge time after onboarding the eBay developer account). Until
// then the generated `Database` type does not contain these tables, so we
// hand-roll narrow Row / Insert / Update shapes here. When 0015 lands and
// `npm run db:types` is run these aliases should be replaced with proper
// references into Database['public']['Tables'][...] / Enums.

export type EbayEnvironment = 'sandbox' | 'production'

export type EbayListingStatus =
  | 'draft'
  | 'submitting'
  | 'active'
  | 'ended'
  | 'sold'
  | 'error'

export type EbayListingFormat = 'FIXED_PRICE' | 'AUCTION'

export type EbayListingEventKind =
  | 'create_offer'
  | 'publish'
  | 'update'
  | 'end'
  | 'sync'
  | 'webhook_received'

/** Hand-written shape for tenant_ebay_credentials.Row until db:types regen. */
export type TenantEbayCredentialsRow = {
  tenant_id: string
  ebay_user_id: string | null
  refresh_token: string | null
  refresh_token_expires_at: string | null
  access_token: string | null
  access_token_expires_at: string | null
  environment: EbayEnvironment
  site_id: string
  merchant_location_key: string | null
  fulfillment_policy_id: string | null
  payment_policy_id: string | null
  return_policy_id: string | null
  connected_at: string | null
  disconnected_at: string | null
  created_at: string
  updated_at: string
}
export type TenantEbayCredentialsInsert = Partial<TenantEbayCredentialsRow> & {
  tenant_id: string
}
export type TenantEbayCredentialsUpdate = Partial<TenantEbayCredentialsRow>

/** Hand-written shape for ebay_listings.Row until db:types regen. */
export type EbayListingRow = {
  id: string
  tenant_id: string
  inventory_item_id: string
  ebay_offer_id: string | null
  ebay_listing_id: string | null
  ebay_sku: string | null
  title: string
  condition_id: string
  category_id: string
  format: EbayListingFormat
  list_price: number | string
  currency: string
  quantity: number
  description: string
  marketing_message: string | null
  photo_urls: string[] | null
  status: EbayListingStatus
  error_text: string | null
  last_synced_at: string | null
  view_count: number | null
  watcher_count: number | null
  sold_at: string | null
  sale_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}
export type EbayListingInsert = Partial<EbayListingRow> & {
  tenant_id: string
  inventory_item_id: string
  title: string
  condition_id: string
  category_id: string
  list_price: number | string
  description: string
}
export type EbayListingUpdate = Partial<EbayListingRow>

/** Hand-written shape for ebay_listing_events.Row until db:types regen. */
export type EbayListingEventRow = {
  id: string
  tenant_id: string
  listing_id: string | null
  kind: EbayListingEventKind
  request_payload: unknown
  response_payload: unknown
  http_status: number | null
  error_text: string | null
  created_at: string
}
export type EbayListingEventInsert = Partial<EbayListingEventRow> & {
  tenant_id: string
  kind: EbayListingEventKind
}
