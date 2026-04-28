import { z } from 'zod'

/**
 * Appraisal Zod schemas — create, update, finalize, void, photos, stones.
 *
 * FormData arrives as strings. Preprocessors normalize empty strings to
 * null and coerce numerics. Money fields use z.coerce.number() but the
 * decimal-safe arithmetic lives in lib/pawn/math.ts (toMoney/r4).
 *
 * Pattern: optionalTrimmedString uses preprocess null-on-empty BEFORE the
 * inner schema, then .transform(v => v ?? null) so ".min(1)" doesn't reject
 * untouched optional fields. Mirrors the bug-locked pattern in
 * src/lib/validations/repair.ts.
 */

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

const optionalShortString = z
  .preprocess(
    (v) => {
      if (typeof v !== 'string') return v
      const trimmed = v.trim()
      return trimmed === '' ? null : trimmed
    },
    z.string().min(1).max(120).nullable().optional(),
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

const requiredDate = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date'),
)

const optionalUuid = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().uuid().nullable().optional(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

const optionalDecimal = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.coerce.number().nonnegative().finite().nullable().optional(),
  )
  .transform((v) => (v === null || v === undefined ? null : v))

const requiredDecimalPositive = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.coerce.number().positive().finite(),
)

// ── Enums ───────────────────────────────────────────────────────────────────

export const appraisalStatusSchema = z.enum(['draft', 'finalized', 'voided'])

export const appraisalPurposeSchema = z.enum([
  'insurance',
  'estate',
  'sale',
  'pawn_intake',
  'collateral_review',
  'customer_request',
])

export const appraisalPhotoKindSchema = z.enum([
  'front',
  'back',
  'detail',
  'serial',
  'cert',
  'reference',
])

const metalTypeSchema = z
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
  .transform((v) => v ?? null)

// ── Stone (per row, used at intake + standalone upsert) ─────────────────────

export const appraisalStoneSchema = z.object({
  position: z.coerce.number().int().min(1).max(99).default(1),
  count: z.coerce.number().int().min(1).max(999).default(1),
  type: optionalShortString,
  cut: optionalShortString,
  est_carat: optionalDecimal,
  color: optionalShortString,
  clarity: optionalShortString,
  certified: z.preprocess(
    (v) => v === 'true' || v === 'on' || v === '1' || v === true,
    z.boolean(),
  ),
  cert_lab: optionalShortString,
  cert_number: optionalShortString,
  notes: optionalTrimmedString,
})

export type AppraisalStoneInput = z.infer<typeof appraisalStoneSchema>

export const appraisalStoneUpsertSchema = appraisalStoneSchema.extend({
  appraisal_id: z.string().uuid(),
  stone_id: optionalUuid,
})

export type AppraisalStoneUpsertInput = z.infer<typeof appraisalStoneUpsertSchema>

export const appraisalInitialStonesArraySchema = z
  .array(appraisalStoneSchema)
  .max(50)
  .optional()
  .default([])

// ── Create appraisal ────────────────────────────────────────────────────────

export const appraisalCreateSchema = z.object({
  customer_id: optionalUuid,
  inventory_item_id: optionalUuid,
  item_description: z.string().trim().min(2, 'too_short').max(2000),
  metal_type: metalTypeSchema,
  karat: optionalDecimal,
  weight_grams: optionalDecimal,
  purpose: appraisalPurposeSchema,
  appraised_value: requiredDecimalPositive,
  replacement_value: optionalDecimal,
  valuation_method: optionalTrimmedString,
  notes: optionalTrimmedString,
  valid_from: requiredDate,
  valid_until: optionalDate,
  stones: appraisalInitialStonesArraySchema,
})

export type AppraisalCreateInput = z.infer<typeof appraisalCreateSchema>

// ── Update appraisal (subset of create — all optional, draft-only at the
//                     action layer) ────────────────────────────────────────

export const appraisalUpdateSchema = z.object({
  appraisal_id: z.string().uuid(),
  customer_id: optionalUuid,
  inventory_item_id: optionalUuid,
  item_description: z
    .string()
    .trim()
    .min(2, 'too_short')
    .max(2000)
    .optional(),
  metal_type: metalTypeSchema,
  karat: optionalDecimal,
  weight_grams: optionalDecimal,
  purpose: appraisalPurposeSchema.optional(),
  appraised_value: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce.number().positive().finite().nullable().optional(),
    )
    .transform((v) => (v === null || v === undefined ? null : v)),
  replacement_value: optionalDecimal,
  valuation_method: optionalTrimmedString,
  notes: optionalTrimmedString,
  valid_from: optionalDate,
  valid_until: optionalDate,
})

export type AppraisalUpdateInput = z.infer<typeof appraisalUpdateSchema>

// ── Finalize ───────────────────────────────────────────────────────────────

export const appraisalFinalizeSchema = z.object({
  appraisal_id: z.string().uuid(),
})

export type AppraisalFinalizeInput = z.infer<typeof appraisalFinalizeSchema>

// ── Void ───────────────────────────────────────────────────────────────────

export const appraisalVoidSchema = z.object({
  appraisal_id: z.string().uuid(),
  void_reason: z.string().trim().min(10, 'too_short').max(2000),
})

export type AppraisalVoidInput = z.infer<typeof appraisalVoidSchema>

// ── Photos ─────────────────────────────────────────────────────────────────

export const appraisalAddPhotoSchema = z.object({
  appraisal_id: z.string().uuid(),
  kind: appraisalPhotoKindSchema,
  caption: optionalTrimmedString,
  position: z.coerce.number().int().min(0).default(0),
})

export type AppraisalAddPhotoInput = z.infer<typeof appraisalAddPhotoSchema>

// ── File constraints ────────────────────────────────────────────────────────

export const ALLOWED_APPRAISAL_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export const ALLOWED_APPRAISAL_SIGNATURE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const

export const MAX_APPRAISAL_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB
export const MAX_APPRAISAL_SIGNATURE_BYTES = 5 * 1024 * 1024 // 5 MB
