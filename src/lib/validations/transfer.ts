import { z } from 'zod'

/**
 * Inventory-transfer Zod schemas.
 *
 * Convention follows customer.ts / inventory.ts: FormData empty strings get
 * preprocessed to null; required strings stay strings. The `item_ids` array
 * comes in either as repeated form fields (multiple checkboxes with the
 * same name) or as a comma-separated string.
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

const itemIdsSchema = z
  .preprocess(
    (v) => {
      if (Array.isArray(v)) return v
      if (typeof v === 'string') {
        // Server actions pass FormData.getAll() through but createTransferAction
        // builds the raw object via formData.get() which only returns the first
        // value. We accept either a JSON-encoded array or a comma-separated
        // list as a fallback.
        const trimmed = v.trim()
        if (trimmed === '') return []
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed)
            if (Array.isArray(parsed)) return parsed
          } catch {
            // fall through to comma split
          }
        }
        return trimmed
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      }
      return []
    },
    z.array(z.string().uuid()).min(1, 'no_items').max(200),
  )

export const createTransferSchema = z.object({
  destination_tenant_id: z.string().uuid('invalid_destination'),
  item_ids: itemIdsSchema,
  notes: optionalTrimmedString,
})

export const rejectTransferSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'reason_too_short')
    .max(2000, 'reason_too_long'),
})

export type CreateTransferInput = z.infer<typeof createTransferSchema>
export type RejectTransferInput = z.infer<typeof rejectTransferSchema>
