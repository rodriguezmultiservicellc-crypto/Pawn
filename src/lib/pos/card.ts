/**
 * Card tender details (patches/0085). Pure — shared by the New sale Charge
 * dialog, the sale page's Add payment dialog, the server actions and the
 * receipt.
 *
 * An EXTERNAL card is one the shop ran on its own machine (Clover, Square,
 * a bank terminal…): staff copy the last 4 digits, the brand and the approval
 * code from the slip, and the database records it as already settled
 * (sale_add_external_card_payment). The same rules are CHECK constraints on
 * sale_payments; this schema only gives the clerk translated errors first.
 */

import { z } from 'zod'

export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'other'] as const
export type CardBrand = (typeof CARD_BRANDS)[number]

export const externalCardSchema = z.object({
  last4: z
    .string()
    .trim()
    .regex(/^[0-9]{4}$/, 'last4'),
  brand: z.enum(CARD_BRANDS),
  /** Approval / authorization code from the slip. Optional; letters + digits. */
  auth_code: z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim().toUpperCase())
    .refine((s) => s === '' || /^[A-Z0-9]{1,12}$/.test(s), 'auth_code')
    .transform((s) => (s === '' ? null : s)),
})

export type ExternalCardInput = z.input<typeof externalCardSchema>
export type ExternalCard = z.output<typeof externalCardSchema>

/**
 * Keep only digits, at most 4 — for the last-4 input. Keeps the LAST four, so
 * pasting a masked number ("**** **** **** 4242") gives 4242.
 */
export function cleanLast4(raw: string): string {
  return raw.replace(/\D/g, '').slice(-4)
}

/** Keep only letters and digits, uppercased, at most 12 — approval code input. */
export function cleanAuthCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
}

/** "VISA •••• 4242 · Auth AB12" — null when the row carries no card details. */
export function cardSummary(
  p: { card_brand?: string | null; card_last4?: string | null; card_auth_code?: string | null },
  brandLabel: (b: string) => string,
  authLabel: string,
): string | null {
  if (!p.card_last4) return null
  const brand = p.card_brand ? `${brandLabel(p.card_brand)} ` : ''
  const auth = p.card_auth_code ? ` · ${authLabel} ${p.card_auth_code}` : ''
  return `${brand}•••• ${p.card_last4}${auth}`
}
