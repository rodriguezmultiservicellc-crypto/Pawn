// src/lib/validations/google-reviews.ts
import { z } from 'zod'

/**
 * Validation for the operator settings form.
 *
 * - place_id: empty string → null; otherwise trimmed non-empty string.
 *   No format regex — Google's "ChIJ..." prefix isn't worth a regex; the
 *   "Test connection" button is the actual validator.
 *
 * - min_star_floor: 1–5 integer. Coerce because the form sends a string.
 *
 * - api_key: secret-field semantics matching the comms form. The field
 *   is encrypted at rest in vault; the form never re-renders the value.
 *     blank submission           → undefined ("no change")
 *     literal '__CLEAR__'        → null      ("delete vault entry")
 *     non-empty trimmed string   → string    ("update vault entry")
 */
const optionalTrimmedString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).nullable(),
)

const secretField = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return undefined
    const trimmed = v.trim()
    if (trimmed === '') return undefined
    if (trimmed === '__CLEAR__') return null
    return trimmed
  },
  z.union([z.string().min(1), z.null(), z.undefined()]),
)

export const googleReviewsSettingsSchema = z.object({
  google_place_id: optionalTrimmedString,
  google_reviews_min_star_floor: z.coerce.number().int().min(1).max(5),
  google_places_api_key: secretField,
})

export type GoogleReviewsSettingsInput = z.infer<
  typeof googleReviewsSettingsSchema
>
