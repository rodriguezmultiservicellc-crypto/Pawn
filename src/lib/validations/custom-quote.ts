import { z } from 'zod'

/**
 * Custom-piece quote schemas (brief Phase 2, patches/0063).
 *
 * The form posts the whole quote as JSON (`payload` field) because the
 * price blocks are nested rows; the server action validates here, then
 * RECOMPUTES every total from the lines (lib/custom-quotes/math) and
 * re-freezes metal at the live spot — nothing money-shaped sent by the
 * browser is trusted as-is.
 */

export const customPieceCategorySchema = z.enum([
  'ring',
  'earrings',
  'chain',
  'bracelet',
  'pendant',
  'nameplate',
  'grillz',
  'other',
])

export const quoteLineKindSchema = z.enum(['metal', 'wax', 'labor', 'stone', 'setting', 'extra'])

export const quoteMetalTypeSchema = z.enum([
  'gold',
  'white_gold',
  'rose_gold',
  'silver',
  'platinum',
  'palladium',
])

const money = z.coerce.number().min(0).max(1_000_000_000).finite()

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(max).nullable().optional(),
    )
    .transform((v) => v ?? null)

/** Kind-specific facts; passthrough so a future source can add keys. */
export const quoteLineDetailsSchema = z
  .object({
    metal_type: quoteMetalTypeSchema.optional(),
    karat: z.string().trim().max(4).optional(),
    weight_source: z.enum(['manual', 'laser_nameplate']).optional(),
    design_ref: z.string().trim().max(120).optional(),
    mode: z.enum(['hourly', 'flat']).optional(),
    hours: z.coerce.number().min(0).max(10_000).optional(),
    rate: money.optional(),
    extra_type: z.enum(['engraving', 'rush', 'packaging', 'shipping', 'other']).optional(),
    sku: z.string().trim().max(60).optional(),
    setting_each: money.optional(),
  })
  .passthrough()

export const quoteLineInputSchema = z.object({
  kind: quoteLineKindSchema,
  label: z.string().trim().min(1, 'required').max(200),
  quantity: z.coerce.number().min(0).max(1_000_000).finite(),
  unit_cost: money,
  unit_price: money,
  price_locked: z.boolean().default(false),
  inventory_item_id: z.string().uuid().nullable().optional(),
  details: quoteLineDetailsSchema.default({}),
})

export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>

export const quoteSaveSchema = z.object({
  customer_id: z.string().uuid(),
  category: customPieceCategorySchema,
  description: z.string().trim().min(1, 'required').max(500),
  size: optionalText(80),
  /** Fractions: 0.5 = 50%. */
  margin_pct: z.coerce.number().min(0).max(0.95),
  deposit_pct: z.coerce.number().min(0).max(1),
  payment_method: z.enum(['cash', 'card', 'check', 'other']).nullable().optional(),
  expires_on: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date').nullable().optional(),
    )
    .transform((v) => v ?? null),
  notes_internal: optionalText(2000),
  lines: z.array(quoteLineInputSchema).min(1, 'at_least_one_line').max(60),
})

export type QuoteSaveInput = z.infer<typeof quoteSaveSchema>

export const quoteStatusActionSchema = z.object({
  quote_id: z.string().uuid(),
  action: z.enum(['send', 'accept', 'decline', 'void', 'convert', 'duplicate']),
})
