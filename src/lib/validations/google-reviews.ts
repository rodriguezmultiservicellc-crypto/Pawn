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
 * - api_key: empty string → null; otherwise trimmed non-empty. Per-tenant
 *   override; platform env fallback handled at the call site, not here.
 */
const optionalTrimmedString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().min(1).nullable(),
)

export const googleReviewsSettingsSchema = z.object({
  google_place_id: optionalTrimmedString,
  google_reviews_min_star_floor: z.coerce.number().int().min(1).max(5),
  google_places_api_key: optionalTrimmedString,
})

export type GoogleReviewsSettingsInput = z.infer<
  typeof googleReviewsSettingsSchema
>
