import { z } from 'zod'

/**
 * Customer Zod schemas. Every form, server action, and API endpoint that
 * touches a customer record validates input through these schemas.
 *
 * Convention: empty strings come in from FormData and we convert to null
 * via .transform/.preprocess. Required text fields stay strings.
 */

// Empty / whitespace-only strings come from FormData on every untouched
// optional input. Convert to null in preprocess BEFORE the inner schema
// runs — otherwise `.min(1)` rejects empty strings and the form fails
// validation on fields the user never typed in.
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

export const idDocumentTypeSchema = z.enum([
  'drivers_license',
  'state_id',
  'passport',
  'military_id',
  'permanent_resident_card',
  'other',
])

export const commPreferenceSchema = z.enum(['email', 'sms', 'whatsapp', 'none'])

export const languageSchema = z.enum(['en', 'es'])

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

export const customerCreateSchema = z.object({
  first_name: z.string().trim().min(1, 'required').max(80),
  last_name: z.string().trim().min(1, 'required').max(80),
  middle_name: optionalTrimmedString,
  date_of_birth: optionalDate,

  phone: optionalTrimmedString,
  phone_alt: optionalTrimmedString,
  email: z
    .preprocess(
      (v) => {
        if (typeof v !== 'string') return v
        const trimmed = v.trim()
        return trimmed === '' ? null : trimmed
      },
      z.string().email().max(254).nullable().optional(),
    )
    .transform((v) => v ?? null),

  address1: optionalTrimmedString,
  address2: optionalTrimmedString,
  city: optionalTrimmedString,
  state: optionalTrimmedString,
  zip: optionalTrimmedString,
  country: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? 'US' : v),
      z.string().trim().min(2).max(2).default('US'),
    ),

  id_type: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      idDocumentTypeSchema.nullable().optional(),
    )
    .transform((v) => v ?? null),
  id_number: optionalTrimmedString,
  id_state: optionalTrimmedString,
  id_country: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? 'US' : v),
      z.string().trim().min(2).max(2).default('US'),
    ),
  id_expiry: optionalDate,

  comm_preference: commPreferenceSchema.default('sms'),
  language: languageSchema.default('en'),
  marketing_opt_in: z.coerce.boolean().default(false),

  // Pawn-only physical description + employment. Optional; ignored on
  // tenants where has_pawn = false (UI hides the section).
  height_inches: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce
        .number()
        .int()
        .min(12)
        .max(108)
        .nullable()
        .optional(),
    )
    .transform((v) => (v == null ? null : v)),
  weight_lbs: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(999)
        .nullable()
        .optional(),
    )
    .transform((v) => (v == null ? null : v)),
  sex: optionalTrimmedString,
  hair_color: optionalTrimmedString,
  eye_color: optionalTrimmedString,
  identifying_marks: optionalTrimmedString,
  place_of_employment: optionalTrimmedString,

  notes: optionalTrimmedString,
  tags: tagsSchema,
  // Full AAMVA PDF417 payload from the back-of-license scanner. NULL
  // when the customer was created without a scan. Cap at 4000 chars —
  // real DL barcodes are ~600-800 chars; the cap protects against
  // pasted free-text masquerading as a scan.
  dl_raw_payload: z
    .preprocess(
      (v) => {
        if (typeof v !== 'string') return v
        const trimmed = v.trim()
        return trimmed === '' ? null : trimmed
      },
      z.string().min(1).max(4000).nullable().optional(),
    )
    .transform((v) => v ?? null),
})

export const customerUpdateSchema = customerCreateSchema.extend({
  id: z.string().uuid(),
  is_banned: z.coerce.boolean().default(false),
  banned_reason: optionalTrimmedString,
})

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>

export const banCustomerSchema = z.object({
  customer_id: z.string().uuid(),
  is_banned: z.coerce.boolean(),
  reason: optionalTrimmedString,
})

export type BanCustomerInput = z.infer<typeof banCustomerSchema>

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024 // 10 MB

export const customerDocumentUploadSchema = z.object({
  customer_id: z.string().uuid(),
  kind: z.enum(['id_scan', 'signature']),
  id_type: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      idDocumentTypeSchema.nullable().optional(),
    )
    .transform((v) => v ?? null),
  id_number: optionalTrimmedString,
  id_state: optionalTrimmedString,
  id_expiry: optionalDate,
})

export type CustomerDocumentUploadInput = z.infer<
  typeof customerDocumentUploadSchema
>
