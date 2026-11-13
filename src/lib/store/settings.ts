/**
 * Online store settings (patches/0078 settings columns). Pure. The form
 * sends percents and dollars; the database stores a fraction and numeric
 * money, and its CHECKs are the final word.
 */

import { z } from 'zod'

const money = z.coerce.number().min(0).max(1_000_000)
const optionalMoney = z
  .union([z.literal(''), z.null(), money])
  .transform((v) => (v === '' || v === null ? null : v))
const text = (max: number) =>
  z.string().trim().max(max).transform((v) => (v ? v : null))

export const storeSettingsSchema = z.object({
  online_checkout_enabled: z.boolean(),
  tax_rate_pct: z.coerce.number().min(0).max(99.99),
  online_pickup_enabled: z.boolean(),
  online_ship_enabled: z.boolean(),
  ship_flat_rate: money,
  ship_free_over: optionalMoney,
  ship_signature_over: optionalMoney,
  online_order_max: z.coerce.number().min(1).max(1_000_000),
  online_reservation_minutes: z.coerce.number().int().min(30).max(120),
  store_return_policy_en: text(5000),
  store_return_policy_es: text(5000),
  store_shipping_policy_en: text(5000),
  store_shipping_policy_es: text(5000),
  store_tagline_en: text(140),
  store_tagline_es: text(140),
  store_accent_color: z
    .string()
    .trim()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^#[0-9a-fA-F]{6}$/.test(v)),
})
// A store must offer at least one way to get the piece.
  .refine((v) => !v.online_checkout_enabled || v.online_pickup_enabled || v.online_ship_enabled)

export type StoreSettingsInput = z.input<typeof storeSettingsSchema>

/** Form values → settings row patch. */
export function toSettingsPatch(v: z.output<typeof storeSettingsSchema>) {
  const { tax_rate_pct, ...rest } = v
  return { ...rest, default_tax_rate: Math.round(tax_rate_pct * 100) / 10000 }
}
