import { z } from 'zod'
import {
  inventoryCategorySchema,
  metalTypeSchema,
} from './inventory'

/**
 * Pawn-loan Zod schemas — intake, payment, extension, forfeit, void.
 *
 * FormData arrives as strings. Preprocessors normalize empty strings to
 * null and coerce numerics. Money fields use z.coerce.number() but we
 * never store the result as a float on the wire — `numeric(18,4)` columns
 * accept JS numbers fine for the precision we need here, and lib/pawn/math
 * does the actual decimal-safe arithmetic with explicit 4dp rounding.
 */

const optionalTrimmedString = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(500).optional().nullable(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

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
    z.coerce.number().nonnegative().finite().nullable().optional(),
  )
  .transform((v) => (v === null || v === undefined ? null : v))

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

const optionalKarat = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().min(0).max(24).nullable().optional(),
  )
  .transform((v) => (v === null || v === undefined ? null : v))

export const paymentMethodSchema = z.enum(['cash', 'card', 'check', 'other'])

// ── Collateral item (per row, used by loanCreateSchema) ────────────────────

export const collateralItemSchema = z.object({
  description: z.string().trim().min(2, 'too_short').max(500),
  category: inventoryCategorySchema.default('other'),
  metal_type: metalTypeSchema.optional().nullable(),
  karat: optionalKarat,
  weight_grams: optionalDecimal,
  est_value: requiredDecimalNonNeg.default(0),
  // Either a Storage path (after upload) or null. The /pawn/new flow first
  // uploads the file, then includes the resulting path in this schema.
  photo_path: optionalTrimmedString,
  position: z.coerce.number().int().min(0).default(0),
})

export type CollateralItemInput = z.infer<typeof collateralItemSchema>

export const collateralItemsArraySchema = z
  .array(collateralItemSchema)
  .min(1, 'at_least_one_item')
  .max(50)

// ── Create loan ─────────────────────────────────────────────────────────────

export const loanCreateSchema = z.object({
  customer_id: z.string().uuid(),
  principal: requiredDecimalPositive,
  interest_rate_monthly: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce.number().min(0).max(0.25).finite(),
    ),
  term_days: z.coerce.number().int().min(1).max(180),
  issue_date: z
    .preprocess(
      (v) =>
        typeof v === 'string' && v.trim() === ''
          ? new Date().toISOString().slice(0, 10)
          : v,
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date'),
    ),
  // Server computes due_date from issue_date + term_days when absent. We
  // accept it for explicit override (e.g., custom term).
  due_date: optionalDate,
  // Storage path for signature image (uploaded prior to this action).
  signature_path: optionalTrimmedString,
  notes: optionalTrimmedString,
  collateral: collateralItemsArraySchema,
})

export type LoanCreateInput = z.infer<typeof loanCreateSchema>

// ── Payment ─────────────────────────────────────────────────────────────────

export const loanPaymentSchema = z
  .object({
    loan_id: z.string().uuid(),
    amount: requiredDecimalPositive,
    payment_method: paymentMethodSchema.default('cash'),
    principal_paid: requiredDecimalNonNeg.default(0),
    interest_paid: requiredDecimalNonNeg.default(0),
    fees_paid: requiredDecimalNonNeg.default(0),
    notes: optionalTrimmedString,
  })
  .superRefine((v, ctx) => {
    // Tolerate floating point: components must sum to amount within $0.0001.
    const sum = v.principal_paid + v.interest_paid + v.fees_paid
    if (Math.abs(sum - v.amount) > 0.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'split_mismatch',
      })
    }
  })

export type LoanPaymentInput = z.infer<typeof loanPaymentSchema>

// ── Extension ───────────────────────────────────────────────────────────────

export const loanExtensionSchema = z.object({
  loan_id: z.string().uuid(),
  new_term_days: z.coerce.number().int().min(1).max(180),
  interest_collected_now: requiredDecimalNonNeg.default(0),
  payment_method: paymentMethodSchema.optional().nullable(),
  notes: optionalTrimmedString,
})

export type LoanExtensionInput = z.infer<typeof loanExtensionSchema>

// ── Forfeiture ──────────────────────────────────────────────────────────────

export const loanForfeitSchema = z.object({
  loan_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type LoanForfeitInput = z.infer<typeof loanForfeitSchema>

// ── Void ────────────────────────────────────────────────────────────────────

export const loanVoidSchema = z.object({
  loan_id: z.string().uuid(),
  reason: z.string().trim().min(10, 'too_short').max(2000),
})

export type LoanVoidInput = z.infer<typeof loanVoidSchema>

// ── File constraints (signature + collateral photos) ────────────────────────

export const ALLOWED_LOAN_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export const ALLOWED_SIGNATURE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

export const MAX_LOAN_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB
export const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024 // 5 MB
