import { z } from 'zod'

/**
 * Inventory Zod schemas — items, photos, stones.
 */

// Empty-after-trim must become null BEFORE the inner schema, otherwise
// .min(1) rejects untouched optional fields.
const optionalTrimmedString = z
  .preprocess(
    (v) => {
      if (typeof v !== 'string') return v
      const trimmed = v.trim()
      return trimmed === '' ? null : trimmed
    },
    z.string().min(1).max(500).nullable().optional(),
  )
  .transform((v) => v ?? null)

const optionalDate = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date')
      .nullable()
      .optional(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

const optionalDecimal = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce
      .number()
      .nonnegative()
      .finite()
      .nullable()
      .optional(),
  )
  .transform((v) => (v === null || v === undefined ? null : v))

const requiredDecimalNonNeg = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
    z.coerce.number().nonnegative().finite(),
  )

export const inventoryCategorySchema = z.enum([
  'ring',
  'necklace',
  'bracelet',
  'earrings',
  'pendant',
  'chain',
  'watch',
  'coin',
  'bullion',
  'loose_stone',
  'electronics',
  'tool',
  'instrument',
  'other',
])

export const inventorySourceSchema = z.enum([
  'pawn_forfeit',
  'bought',
  'consigned',
  'new_stock',
  'repair_excess',
  'abandoned_repair',
])

export const inventoryStatusSchema = z.enum([
  'available',
  'held',
  'sold',
  'scrapped',
  'transferred',
  'returned',
])

export const metalTypeSchema = z.enum([
  'gold',
  'silver',
  'platinum',
  'palladium',
  'rose_gold',
  'white_gold',
  'tungsten',
  'titanium',
  'stainless_steel',
  'mixed',
  'none',
  'other',
])

export const inventoryLocationSchema = z.enum([
  'case',
  'safe',
  'vault',
  'display',
  'workshop',
  'offsite',
  'transfer',
])

const tagsSchema = z
  .preprocess(
    (v) => {
      if (Array.isArray(v)) return v
      if (typeof v === 'string') {
        return v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      }
      return []
    },
    z.array(z.string().min(1).max(40)).max(20),
  )
  .default([])

export const inventoryItemCreateSchema = z.object({
  // Optional — when blank, the BEFORE INSERT trigger assigns the next
  // per-tenant SKU. When provided, must be unique within the tenant.
  sku: optionalTrimmedString,

  description: z.string().trim().min(1, 'required').max(500),
  category: inventoryCategorySchema.default('other'),
  brand: optionalTrimmedString,
  model: optionalTrimmedString,
  serial_number: optionalTrimmedString,

  metal: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      metalTypeSchema.nullable().optional(),
    )
    .transform((v) => v ?? null),
  karat: optionalTrimmedString,
  weight_grams: optionalDecimal,
  weight_dwt: optionalDecimal,

  cost_basis: requiredDecimalNonNeg.default(0),
  list_price: optionalDecimal,

  source: inventorySourceSchema,
  source_vendor: optionalTrimmedString,
  acquired_at: z
    .preprocess(
      (v) =>
        typeof v === 'string' && v.trim() === ''
          ? new Date().toISOString().slice(0, 10)
          : v,
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date'),
    ),
  acquired_cost: optionalDecimal,

  hold_until: optionalDate,

  location: inventoryLocationSchema.default('case'),
  status: inventoryStatusSchema.default('available'),

  notes: optionalTrimmedString,
  staff_memo: optionalTrimmedString,
  tags: tagsSchema,

  is_hidden_from_catalog: z
    .preprocess((v) => v === 'on' || v === true || v === 'true', z.boolean())
    .default(false),
})

export const inventoryItemUpdateSchema = inventoryItemCreateSchema.extend({
  id: z.string().uuid(),
  sale_price: optionalDecimal,
})

export type InventoryItemCreateInput = z.infer<typeof inventoryItemCreateSchema>
export type InventoryItemUpdateInput = z.infer<typeof inventoryItemUpdateSchema>

export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB

export const inventoryStoneSchema = z.object({
  // Tag for client-side keying; ignored on insert/update server-side.
  client_id: z.string().optional(),
  // Server-side id when editing existing rows.
  id: z.string().uuid().optional(),
  count: z.coerce.number().int().min(1).max(999).default(1),
  stone_type: optionalTrimmedString,
  cut: optionalTrimmedString,
  carat: optionalDecimal,
  is_total_carat: z.coerce.boolean().default(false),
  color: optionalTrimmedString,
  clarity: optionalTrimmedString,
  certificate: optionalTrimmedString,
  position: z.coerce.number().int().min(0).default(0),
  notes: optionalTrimmedString,
})

export const inventoryStonesArraySchema = z.array(inventoryStoneSchema).max(50)

export type InventoryStoneInput = z.infer<typeof inventoryStoneSchema>

export const setPrimaryPhotoSchema = z.object({
  photo_id: z.string().uuid(),
})
