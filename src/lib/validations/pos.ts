import { z } from 'zod'

/**
 * POS Zod schemas — register sessions, sales, sale items, sale payments,
 * returns, layaways, layaway payments, terminal pairing.
 *
 * FormData arrives as strings. Preprocessors normalize empty strings to null
 * and coerce numerics. Money fields use z.coerce.number() but the action
 * layer rounds via lib/pos/cart.ts (r4) before persistence. numeric(18,4)
 * columns accept JS numbers fine for the precision we need.
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
    z.string().min(1).max(2000).nullable().optional(),
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

const requiredDecimalNonNeg = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
    z.coerce.number().nonnegative().finite(),
  )

const requiredDecimalPositive = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().positive().finite(),
  )

const optionalUuid = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().uuid().nullable().optional(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

const boolFromForm = z.preprocess((v) => {
  if (v === 'on' || v === 'true' || v === '1' || v === true) return true
  if (v === '' || v == null || v === 'false' || v === '0') return false
  return v
}, z.boolean())

export const paymentMethodSchema = z.enum(['cash', 'card', 'check', 'other'])

// ── Register session ────────────────────────────────────────────────────────

export const openRegisterSchema = z.object({
  opening_cash: requiredDecimalNonNeg.default(0),
  notes: optionalTrimmedString,
})
export type OpenRegisterInput = z.infer<typeof openRegisterSchema>

export const closeRegisterSchema = z.object({
  session_id: z.string().uuid(),
  closing_cash_counted: requiredDecimalNonNeg.default(0),
  card_batch_total: requiredDecimalNonNeg.default(0),
  notes: optionalTrimmedString,
})
export type CloseRegisterInput = z.infer<typeof closeRegisterSchema>

// ── Sale items (per row, used by saleCreateSchema) ──────────────────────────

export const saleItemSchema = z.object({
  inventory_item_id: optionalUuid,
  description: z.string().trim().min(1, 'too_short').max(500),
  quantity: requiredDecimalPositive.default(1),
  unit_price: requiredDecimalNonNeg.default(0),
  line_discount: requiredDecimalNonNeg.default(0),
  position: z.coerce.number().int().min(0).default(0),
})
export type SaleItemInput = z.infer<typeof saleItemSchema>

export const saleItemsArraySchema = z
  .array(saleItemSchema)
  .min(1, 'at_least_one_item')
  .max(200)

// ── Create sale ─────────────────────────────────────────────────────────────

export const saleCreateSchema = z.object({
  customer_id: optionalUuid,
  // Decimal fraction; e.g. 0.0825 = 8.25%.
  tax_rate: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
      z.coerce.number().min(0).max(1).finite(),
    )
    .default(0),
  discount_amount: requiredDecimalNonNeg.default(0),
  notes: optionalTrimmedString,
  items: saleItemsArraySchema,
})
export type SaleCreateInput = z.infer<typeof saleCreateSchema>

// ── Sale payment ────────────────────────────────────────────────────────────

export const saleAddPaymentSchema = z.object({
  sale_id: z.string().uuid(),
  amount: requiredDecimalPositive,
  payment_method: paymentMethodSchema.default('cash'),
  reader_id: optionalTrimmedString,
  notes: optionalTrimmedString,
})
export type SaleAddPaymentInput = z.infer<typeof saleAddPaymentSchema>

// ── Sale void ───────────────────────────────────────────────────────────────

export const saleVoidSchema = z.object({
  sale_id: z.string().uuid(),
  reason: z.string().trim().min(10, 'too_short').max(2000),
})
export type SaleVoidInput = z.infer<typeof saleVoidSchema>

// ── Return ──────────────────────────────────────────────────────────────────

export const returnLineSchema = z.object({
  sale_item_id: z.string().uuid(),
  quantity: requiredDecimalPositive,
  restock: boolFromForm.default(true),
})
export type ReturnLineInput = z.infer<typeof returnLineSchema>

export const returnCreateSchema = z.object({
  sale_id: z.string().uuid(),
  reason: z.string().trim().min(10, 'too_short').max(2000),
  refund_method: paymentMethodSchema.default('cash'),
  items: z.array(returnLineSchema).min(1, 'at_least_one_item').max(200),
})
export type ReturnCreateInput = z.infer<typeof returnCreateSchema>

// ── Layaway create (pairs with sale_kind='layaway' creation) ────────────────

export const layawayScheduleKindSchema = z.enum([
  'weekly',
  'biweekly',
  'monthly',
  'custom',
])

export const layawayCreateSchema = z.object({
  // Layaway requires an identified customer.
  customer_id: z.string().uuid('invalid_customer'),
  tax_rate: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
      z.coerce.number().min(0).max(1).finite(),
    )
    .default(0),
  discount_amount: requiredDecimalNonNeg.default(0),
  schedule_kind: layawayScheduleKindSchema.default('weekly'),
  down_payment: requiredDecimalNonNeg.default(0),
  down_payment_method: paymentMethodSchema.default('cash'),
  first_payment_due: optionalDate,
  final_due_date: optionalDate,
  cancellation_fee_pct: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
      z.coerce.number().min(0).max(1).finite(),
    )
    .default(0),
  notes: optionalTrimmedString,
  items: saleItemsArraySchema,
})
export type LayawayCreateInput = z.infer<typeof layawayCreateSchema>

// ── Layaway payment ─────────────────────────────────────────────────────────

export const layawayAddPaymentSchema = z.object({
  layaway_id: z.string().uuid(),
  amount: requiredDecimalPositive,
  payment_method: paymentMethodSchema.default('cash'),
  reader_id: optionalTrimmedString,
  notes: optionalTrimmedString,
})
export type LayawayAddPaymentInput = z.infer<typeof layawayAddPaymentSchema>

// ── Layaway cancel ──────────────────────────────────────────────────────────

export const layawayCancelSchema = z.object({
  layaway_id: z.string().uuid(),
  reason: z.string().trim().min(10, 'too_short').max(2000),
  restock_items: boolFromForm.default(true),
})
export type LayawayCancelInput = z.infer<typeof layawayCancelSchema>

// ── Stripe Terminal pairing (stub) ──────────────────────────────────────────

export const terminalReaderConnectSchema = z.object({
  reader_id: z.string().trim().min(1, 'too_short').max(200),
})
export type TerminalReaderConnectInput = z.infer<
  typeof terminalReaderConnectSchema
>
