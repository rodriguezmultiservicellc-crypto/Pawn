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

export type TransferStatus = 'pending' | 'in_transit' | 'received' | 'cancelled'

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
