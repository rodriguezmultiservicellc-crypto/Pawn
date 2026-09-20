import { z } from 'zod'

/**
 * Consignment Zod schemas (patches/0054).
 *
 * Commission is stored and validated as a FRACTION (0.2 = 20%). The form
 * shows percent and divides before submit — keeping the wire format equal
 * to the column format means no unit can drift between the UI, the action
 * and the accrual trigger.
 */

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

/** 0..1 inclusive — the same domain as the NUMERIC(6,4) CHECK. */
const commissionFraction = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.coerce.number().min(0).max(1).finite(),
)

export const consignorStatusSchema = z.enum(['active', 'inactive'])

export const payoutMethodSchema = z.enum(['cash', 'card', 'check', 'other'])

export const consignorCreateSchema = z.object({
  customer_id: z.string().uuid('invalid_customer'),
  business_name: optionalTrimmedString,
  default_commission_pct: commissionFraction,
  default_payout_method: payoutMethodSchema.default('cash'),
  notes: optionalTrimmedString,
})
export type ConsignorCreateInput = z.infer<typeof consignorCreateSchema>

export const consignorUpdateSchema = consignorCreateSchema
  .omit({ customer_id: true })
  .extend({
    id: z.string().uuid(),
    status: consignorStatusSchema.default('active'),
  })
export type ConsignorUpdateInput = z.infer<typeof consignorUpdateSchema>

export const consignorPayoutSchema = z.object({
  consignor_id: z.string().uuid(),
  payout_method: payoutMethodSchema.default('cash'),
  reference: optionalTrimmedString,
})
export type ConsignorPayoutInput = z.infer<typeof consignorPayoutSchema>

/** Hand a consigned item back to its owner, unsold. */
export const consignmentReturnItemSchema = z.object({
  item_id: z.string().uuid(),
  reason: optionalTrimmedString,
})
export type ConsignmentReturnItemInput = z.infer<
  typeof consignmentReturnItemSchema
>
