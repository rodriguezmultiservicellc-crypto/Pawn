import { z } from 'zod'
import { paymentMethodSchema } from './loan'

/**
 * Repair-ticket Zod schemas — intake, quote, approval, deposit, start,
 * complete, pickup, abandon, void, plus stone / part / photo / timer subops.
 *
 * FormData arrives as strings. Preprocessors normalize empty strings to
 * null and coerce numerics. Money fields use z.coerce.number() but the
 * decimal-safe arithmetic lives in lib/repair/billing.ts (mirrors lib/pawn/math).
 */

const optionalTrimmedString = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(2000).optional().nullable(),
  )
  .transform((v) => (v === '' || v == null ? null : v))

const optionalShortString = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).max(120).optional().nullable(),
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

const requiredDecimalNonNeg = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
  z.coerce.number().nonnegative().finite(),
)

const requiredDecimalPositive = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.coerce.number().positive().finite(),
)

// ── Enums ───────────────────────────────────────────────────────────────────

export const serviceTypeSchema = z.enum([
  'repair',
  'stone_setting',
  'sizing',
  'restring',
  'plating',
  'engraving',
  'custom',
])

export const repairStatusSchema = z.enum([
  'intake',
  'quoted',
  'awaiting_approval',
  'in_progress',
  'needs_parts',
  'ready',
  'picked_up',
  'abandoned',
  'voided',
])

export const repairPhotoKindSchema = z.enum([
  'intake',
  'in_progress',
  'final',
  'reference',
])

export const stoneSourceSchema = z.enum(['customer_supplied', 'shop_supplied'])

// ── Stone (per row) ─────────────────────────────────────────────────────────

export const repairAddStoneSchema = z.object({
  ticket_id: z.string().uuid(),
  stone_index: z.coerce.number().int().min(1).max(99),
  stone_type: z.string().trim().min(1, 'required').max(60),
  shape: optionalShortString,
  size_mm: optionalDecimal,
  weight_carats: optionalDecimal,
  color: optionalShortString,
  clarity: optionalShortString,
  mounting_type: optionalShortString,
  mounting_position: optionalShortString,
  source: stoneSourceSchema,
  shop_inventory_item_id: optionalUuid,
  notes: optionalTrimmedString,
})

export type RepairAddStoneInput = z.infer<typeof repairAddStoneSchema>

// Used by the create form for any pre-populated stones submitted with intake.
export const repairInitialStoneSchema = repairAddStoneSchema.omit({
  ticket_id: true,
})
export const repairInitialStonesArraySchema = z
  .array(repairInitialStoneSchema)
  .max(50)
  .optional()
  .default([])

// ── Create ticket ───────────────────────────────────────────────────────────

export const repairTicketCreateSchema = z.object({
  customer_id: z.string().uuid(),
  service_type: serviceTypeSchema,
  title: z.string().trim().min(2, 'too_short').max(200),
  item_description: z.string().trim().min(2, 'too_short').max(2000),
  description: optionalTrimmedString,
  promised_date: optionalDate,
  assigned_to: optionalUuid,
  notes_internal: optionalTrimmedString,
  stones: repairInitialStonesArraySchema,
})

export type RepairTicketCreateInput = z.infer<typeof repairTicketCreateSchema>

// ── Update ticket (subset of create) ────────────────────────────────────────

export const repairTicketUpdateSchema = z.object({
  ticket_id: z.string().uuid(),
  title: z.string().trim().min(2, 'too_short').max(200).optional(),
  item_description: z
    .string()
    .trim()
    .min(2, 'too_short')
    .max(2000)
    .optional(),
  description: optionalTrimmedString,
  promised_date: optionalDate,
  assigned_to: optionalUuid,
  notes_internal: optionalTrimmedString,
})

export type RepairTicketUpdateInput = z.infer<typeof repairTicketUpdateSchema>

// ── Quote / approval / deposit ──────────────────────────────────────────────

export const repairQuoteSchema = z.object({
  ticket_id: z.string().uuid(),
  quote_amount: requiredDecimalPositive,
  notes: optionalTrimmedString,
})

export type RepairQuoteInput = z.infer<typeof repairQuoteSchema>

export const repairApproveQuoteSchema = z.object({
  ticket_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type RepairApproveQuoteInput = z.infer<typeof repairApproveQuoteSchema>

export const repairCollectDepositSchema = z.object({
  ticket_id: z.string().uuid(),
  deposit_amount: requiredDecimalPositive,
  payment_method: paymentMethodSchema.default('cash'),
  notes: optionalTrimmedString,
})

export type RepairCollectDepositInput = z.infer<
  typeof repairCollectDepositSchema
>

// ── Workflow transitions ────────────────────────────────────────────────────

export const repairStartWorkSchema = z.object({
  ticket_id: z.string().uuid(),
  assigned_to: optionalUuid,
  notes: optionalTrimmedString,
})

export type RepairStartWorkInput = z.infer<typeof repairStartWorkSchema>

export const repairNeedsPartsSchema = z.object({
  ticket_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type RepairNeedsPartsInput = z.infer<typeof repairNeedsPartsSchema>

export const repairPartsReceivedSchema = z.object({
  ticket_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type RepairPartsReceivedInput = z.infer<typeof repairPartsReceivedSchema>

export const repairCompleteSchema = z.object({
  ticket_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type RepairCompleteInput = z.infer<typeof repairCompleteSchema>

// ── Pickup ──────────────────────────────────────────────────────────────────

export const repairPickupSchema = z.object({
  ticket_id: z.string().uuid(),
  pickup_by_name: z.string().trim().min(2, 'too_short').max(200),
  pickup_id_check: optionalShortString,
  payment_method: paymentMethodSchema.default('cash'),
  paid_amount: requiredDecimalNonNeg.default(0),
  notes: optionalTrimmedString,
})

export type RepairPickupInput = z.infer<typeof repairPickupSchema>

// ── Abandonment / void ──────────────────────────────────────────────────────

export const repairAbandonSchema = z.object({
  ticket_id: z.string().uuid(),
  abandon_reason: z.string().trim().min(10, 'too_short').max(2000),
})

export type RepairAbandonInput = z.infer<typeof repairAbandonSchema>

export const repairVoidSchema = z.object({
  ticket_id: z.string().uuid(),
  reason: z.string().trim().min(10, 'too_short').max(2000),
})

export type RepairVoidInput = z.infer<typeof repairVoidSchema>

// ── Assign / note ───────────────────────────────────────────────────────────

export const repairAssignSchema = z.object({
  ticket_id: z.string().uuid(),
  assigned_to: optionalUuid,
})

export type RepairAssignInput = z.infer<typeof repairAssignSchema>

export const repairAddNoteSchema = z.object({
  ticket_id: z.string().uuid(),
  notes: z.string().trim().min(1, 'required').max(2000),
})

export type RepairAddNoteInput = z.infer<typeof repairAddNoteSchema>

// ── Parts ───────────────────────────────────────────────────────────────────

export const repairAddPartSchema = z.object({
  ticket_id: z.string().uuid(),
  inventory_item_id: optionalUuid,
  description: z.string().trim().min(2, 'too_short').max(500),
  quantity: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? 1 : v),
    z.coerce.number().positive().finite(),
  ),
  unit_cost: requiredDecimalNonNeg.default(0),
  notes: optionalTrimmedString,
})

export type RepairAddPartInput = z.infer<typeof repairAddPartSchema>

// ── Photos ──────────────────────────────────────────────────────────────────

export const repairAddPhotoSchema = z.object({
  ticket_id: z.string().uuid(),
  kind: repairPhotoKindSchema,
  caption: optionalTrimmedString,
  position: z.coerce.number().int().min(0).default(0),
})

export type RepairAddPhotoInput = z.infer<typeof repairAddPhotoSchema>

export const repairSetCaptionSchema = z.object({
  photo_id: z.string().uuid(),
  caption: optionalTrimmedString,
})

export type RepairSetCaptionInput = z.infer<typeof repairSetCaptionSchema>

// ── Timers ──────────────────────────────────────────────────────────────────

export const repairTimeStartSchema = z.object({
  ticket_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type RepairTimeStartInput = z.infer<typeof repairTimeStartSchema>

export const repairTimeStopSchema = z.object({
  time_log_id: z.string().uuid(),
  notes: optionalTrimmedString,
})

export type RepairTimeStopInput = z.infer<typeof repairTimeStopSchema>

// ── File constraints ────────────────────────────────────────────────────────

export const ALLOWED_REPAIR_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export const ALLOWED_REPAIR_SIGNATURE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

export const MAX_REPAIR_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB
export const MAX_REPAIR_SIGNATURE_BYTES = 5 * 1024 * 1024 // 5 MB
