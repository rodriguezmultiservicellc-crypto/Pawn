import { z } from 'zod'

/**
 * Buy-outright (gold-buying) Zod schemas. Mirror loan-collateral shape so
 * the upload + storage helpers compose the same way; differs in that:
 *   - Each item becomes a row in inventory_items (source='bought'),
 *     not a frozen pawn_collateral_items snapshot.
 *   - Each item carries a per-item payout (USD operator pays the
 *     customer). The form pre-fills this from melt × tenant multiplier
 *     but the operator can override.
 *   - There's no "principal / interest / due date" — just a customer +
 *     items + total payout.
 */

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

const optionalDecimal = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().nonnegative().finite().nullable().optional(),
  )
  .transform((v) => (v == null ? null : v))

const requiredDecimalNonNeg = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
  z.coerce.number().nonnegative().finite(),
)

export const buyItemSchema = z.object({
  description: z.string().trim().min(1, 'required').max(500),
  category: z
    .enum([
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
    .default('other'),
  metal: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z
        .enum([
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
        .nullable()
        .optional(),
    )
    .transform((v) => v ?? null),
  karat: optionalTrimmedString,
  weight_grams: optionalDecimal,
  /** Per-item payout — what the operator hands the customer for this
   *  item. Required and must be > 0 (we don't accept "free" buys). */
  payout: requiredDecimalNonNeg,
  /** Operator-supplied serial / engraving / model — recorded for police
   *  report items_snapshot. */
  serial_number: optionalTrimmedString,
  /** Storage path filled in by the action after photo upload; the form
   *  passes null. */
  photo_path: z.string().nullable().optional(),
  position: z.coerce.number().int().min(0).default(0),
})

export type BuyItemInput = z.infer<typeof buyItemSchema>

export const buyOutrightSchema = z.object({
  customer_id: z.string().uuid(),
  payment_method: z.enum(['cash', 'card', 'check', 'other']).default('cash'),
  notes: optionalTrimmedString,
  items: z.array(buyItemSchema).min(1, 'at_least_one_item').max(20),
})

export type BuyOutrightInput = z.infer<typeof buyOutrightSchema>

export const ALLOWED_BUY_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export const MAX_BUY_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB
