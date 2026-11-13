/**
 * Checkout input from the public cart page. Pure. Everything here is
 * re-checked by online_order_reserve(); this only rejects malformed input
 * early with a field-level answer.
 */

import { z } from 'zod'

const trimmed = (max: number) => z.string().trim().min(1).max(max)

export const checkoutSchema = z
  .object({
    itemIds: z.array(z.uuid()).min(1).max(10),
    name: trimmed(120),
    email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(200)),
    phone: z.string().trim().max(40).optional().transform((v) => (v ? v : null)),
    language: z.enum(['en', 'es']).default('en'),
    fulfillment: z.enum(['pickup', 'ship']),
    address: z
      .object({
        line1: trimmed(200),
        line2: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
        city: trimmed(100),
        state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
        postal: z.string().trim().regex(/^\d{5}(-\d{4})?$/),
      })
      .nullable()
      .optional(),
  })
  .refine((v) => v.fulfillment === 'pickup' || !!v.address, { path: ['address'], message: 'address_required' })

export type CheckoutRequest = z.input<typeof checkoutSchema>

export const cartRefreshSchema = z.object({ itemIds: z.array(z.uuid()).max(10) })
