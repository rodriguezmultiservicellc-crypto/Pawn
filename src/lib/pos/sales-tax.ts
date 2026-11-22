/**
 * Sales tax by district (patches/0094). Pure: the edit-form schema and the
 * helpers that turn a shop's rates into the one rate a sale is charged.
 *
 * A shop's tax is a stack — state + county + sometimes a city or a special
 * district. Each is a row in `tax_rates`; the rate charged is the sum of the
 * active rows. A database trigger keeps that sum in
 * settings.default_tax_rate, which the POS pre-fills from and the online
 * store charges. Nothing here knows any state's rate: a shop types its own.
 */

import { z } from 'zod'
import { fractionToPercent } from '@/lib/format/money'

export const SALES_TAX_EDIT_ROLES = ['owner', 'chain_admin', 'manager'] as const
export const SALES_TAX_MAX = 8

/** Who levies the tax. Order here is the order rates are listed in. */
export const TAX_LEVELS = ['state', 'county', 'city', 'district', 'other'] as const
export type TaxLevel = (typeof TAX_LEVELS)[number]

export type TaxRate = {
  id: string
  name: string
  level: TaxLevel
  /** Fraction: 0.015 = 1.5%. */
  rate: number
  is_active: boolean
}

/**
 * A percent typed by a person → the stored fraction. The column holds four
 * decimals of the fraction, so two decimals of the percent: 6, 1.5, 6.25.
 * A finer rate (8.875) is refused — rounding it would charge the wrong tax.
 */
const percentAsRate = z.coerce
  .number()
  .gt(0)
  .max(100)
  .finite()
  .refine((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-6, { message: 'precision' })
  .transform((p) => Math.round(p * 100) / 10000)

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  level: z.enum(TAX_LEVELS),
  percent: percentAsRate,
  is_active: z.boolean(),
})

export type TaxRateInput = z.input<typeof taxRateInputSchema>

/** The rate a sale is charged: the sum of the active rows, as a fraction. */
export function totalTaxRate(rates: Pick<TaxRate, 'rate' | 'is_active'>[]): number {
  const sum = rates.reduce((acc, r) => (r.is_active ? acc + r.rate : acc), 0)
  return Math.round(sum * 10000) / 10000
}

/** State first, then county, city, district, other — the order a shop reads its tax in. */
export function byTaxLevel<T extends Pick<TaxRate, 'level'>>(rates: T[]): T[] {
  return [...rates].sort((a, b) => TAX_LEVELS.indexOf(a.level) - TAX_LEVELS.indexOf(b.level))
}

/** "Florida 6% + Hillsborough County 1.5%" — the active rates, for a caption. */
export function taxBreakdown(rates: Pick<TaxRate, 'name' | 'rate' | 'is_active'>[]): string {
  return rates
    .filter((r) => r.is_active)
    .map((r) => `${r.name} ${fractionToPercent(r.rate)}%`)
    .join(' + ')
}
