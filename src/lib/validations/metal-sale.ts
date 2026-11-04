import { z } from 'zod'

/**
 * Sell-metal (scrap / bullion out the door) schemas — Sol Pawn brief
 * Phase 3. The sale is persisted as an ordinary `sales` row with
 * sale_kind='metal' (patches/0064-0065); these schemas shape the counter
 * form's submission.
 *
 * Money the browser sends (line price, tax) is validated here and then
 * RE-SUMMED server-side; spot and the sell multiplier are frozen from the
 * live feed at submit time, never trusted from the form.
 */

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().min(1).max(max).nullable().optional(),
    )
    .transform((v) => v ?? null)

const optionalUuid = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().uuid().nullable().optional(),
  )
  .transform((v) => v ?? null)

const optionalDecimal = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().nonnegative().finite().nullable().optional(),
  )
  .transform((v) => (v == null ? null : v))

export const metalSaleMetalSchema = z.enum(['gold', 'silver', 'platinum', 'palladium'])

export const metalSalePuritySchema = z.enum([
  'pure_24k',
  '22k',
  '18k',
  '14k',
  '10k',
  'sterling_925',
  'platinum_950',
  'palladium_950',
  'fine',
])

export const metalSaleLineSchema = z.object({
  description: z.string().trim().min(1, 'required').max(300),
  metal: metalSaleMetalSchema,
  purity: metalSalePuritySchema,
  weight_grams: z.coerce.number().positive('required').max(1_000_000).finite(),
  /** Line total in USD — what the buyer pays for this line. */
  price: z.coerce.number().positive('required').max(1_000_000_000).finite(),
  inventory_item_id: optionalUuid,
  position: z.coerce.number().int().min(0).default(0),
})

export type MetalSaleLineInput = z.infer<typeof metalSaleLineSchema>

/** Tenders the sell counter offers. 'mixed' = cash + transfer (two ledger rows). */
export const metalSalePaymentSchema = z.enum(['cash', 'transfer', 'check', 'mixed'])

export const metalSaleSchema = z
  .object({
    customer_id: optionalUuid,
    counterparty_name: optionalText(200),
    /** Decimal fraction; 0.07 = 7%. */
    tax_rate: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
        z.coerce.number().min(0).max(1).finite(),
      )
      .default(0),
    payment_method: metalSalePaymentSchema.default('cash'),
    paid_cash: optionalDecimal,
    paid_transfer: optionalDecimal,
    notes: optionalText(2000),
    lines: z.array(metalSaleLineSchema).min(1, 'at_least_one_line').max(60),
  })
  .refine((v) => v.customer_id != null || v.counterparty_name != null, {
    path: ['counterparty_name'],
    message: 'counterparty_required',
  })

export type MetalSaleInput = z.infer<typeof metalSaleSchema>
