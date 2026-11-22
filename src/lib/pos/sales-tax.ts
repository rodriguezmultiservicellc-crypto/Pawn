/**
 * Sales tax by district (patches/0094-0095). Pure: the edit-form schema and
 * the arithmetic that turns a shop's tax lines into the tax of a sale.
 *
 * A shop's tax is a stack — state + county + sometimes a city or a special
 * district. Each is a row in `tax_rates`. Some stop at part of an item's
 * price ("only the first $X of each item"): that is `item_cap`, a setting of
 * the row. Nothing here knows any state's rate or cap: a shop types its own.
 *
 * The database is the authority: sales_tax_quote() (0095) computes the tax
 * when the sale is written. quoteSaleTax() below is the SAME arithmetic, in
 * whole cents and whole rate points, so the screen shows the number the
 * database will charge:
 *
 *   tax          = round( Σ over tax lines and cart lines of
 *                         taxable part × rate )            — rounded ONCE
 *   taxable part = the line after every discount, or
 *                  item_cap × quantity when that is less
 *
 * With no caps that is exactly (subtotal − discount) × total rate.
 */

import { z } from 'zod'
import { fractionToPercent } from '@/lib/format/money'
import { computeLineTotal, computeTotal, r2, type CartLine, type CartTotals } from './cart'

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
  /** Dollars. The tax applies only to the first `item_cap` of each item; null = the whole price. */
  item_cap: number | null
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

/** Optional dollars, to the cent: blank = no cap. Zero or less is refused (use blank). */
const optionalCap = z
  .preprocess(
    (v) => (v == null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z.coerce.number().gt(0).max(100_000_000).finite().nullable(),
  )
  .transform((v) => (v == null ? null : Math.round(v * 100) / 100))

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  level: z.enum(TAX_LEVELS),
  percent: percentAsRate,
  item_cap: optionalCap,
  is_active: z.boolean(),
})

export type TaxRateInput = z.input<typeof taxRateInputSchema>

/** The nominal rate: the sum of the active rows, as a fraction. */
export function totalTaxRate(rates: Pick<TaxRate, 'rate' | 'is_active'>[]): number {
  const sum = rates.reduce((acc, r) => (r.is_active ? acc + r.rate : acc), 0)
  return Math.round(sum * 10000) / 10000
}

/** State first, then county, city, district, other — the order a shop reads its tax in. */
export function byTaxLevel<T extends Pick<TaxRate, 'level'>>(rates: T[]): T[] {
  return [...rates].sort((a, b) => TAX_LEVELS.indexOf(a.level) - TAX_LEVELS.indexOf(b.level))
}

/**
 * "Florida 6% + Hillsborough County 1.5% (first $5,000 of each item)" — the
 * active rates, for a caption. `capNote` words the cap in the user's language.
 */
export function taxBreakdown(
  rates: Pick<TaxRate, 'name' | 'rate' | 'item_cap' | 'is_active'>[],
  capNote: (cap: number) => string,
): string {
  return rates
    .filter((r) => r.is_active)
    .map((r) => `${r.name} ${fractionToPercent(r.rate)}%${r.item_cap != null ? ` ${capNote(r.item_cap)}` : ''}`)
    .join(' + ')
}

// ── The tax of a sale ─────────────────────────────────────────────────────

export type SaleTaxPart = {
  name: string
  level: TaxLevel
  rate: number
  item_cap: number | null
  /** What this tax line was charged on. */
  taxable: number
  tax: number
}

export type SaleTax = {
  tax: number
  /** Nominal rate: the sum of the active tax lines. */
  rate: number
  /** Each cart line after its share of the cart discount. */
  net: number[]
  /** Each cart line's share of the tax (adds up to `tax`). */
  lineTax: number[]
  /** One entry per active tax line (adds up to `tax`). */
  parts: SaleTaxPart[]
}

/** Whole cents from dollars. */
const cents = (dollars: number) => Math.round(r2(dollars) * 100)
/** Round half up, for non-negative whole numbers: round(n / d). */
const halfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d))
/** Index of the largest value, the first one on a tie; -1 for an empty list. */
function largest(values: number[]): number {
  let at = -1
  for (let i = 0; i < values.length; i++) if (at < 0 || values[i] > values[at]) at = i
  return at
}

/**
 * Spread a cart discount over the lines by value, to the cent. Leftover
 * cents from rounding go to the largest line, so the lines add up to
 * (subtotal − discount). Mirrors sale_create (0095).
 */
export function allocateDiscount(lineCents: number[], discountCents: number): number[] {
  const subtotal = lineCents.reduce((a, b) => a + b, 0)
  const discount = Math.min(Math.max(0, discountCents), subtotal)
  const net = lineCents.map((l) => {
    if (subtotal <= 0) return l
    // BigInt: discount × line can pass 2^53 on a very large sale.
    const share = (BigInt(2) * BigInt(discount) * BigInt(l) + BigInt(subtotal)) / (BigInt(2) * BigInt(subtotal))
    return l - Number(share)
  })
  const fix = subtotal - discount - net.reduce((a, b) => a + b, 0)
  if (fix !== 0) {
    const at = largest(lineCents)
    if (at >= 0) net[at] = Math.max(0, net[at] + fix)
  }
  return net
}

/**
 * The tax of a cart under the shop's tax lines — the on-screen mirror of
 * sales_tax_quote() + the discount step of sale_create() (patches/0095).
 * Amounts are whole cents and rates whole ten-thousandths, so there is no
 * floating-point drift and the result equals the database's to the cent.
 *
 * @param lines    each cart line: quantity and line total (after its own line discount)
 * @param discount the cart-level discount, dollars
 * @param rates    the shop's tax lines, in list order (state first)
 */
export function quoteSaleTax(
  lines: ReadonlyArray<{ quantity: number; lineTotal: number }>,
  discount: number,
  rates: ReadonlyArray<Pick<TaxRate, 'name' | 'level' | 'rate' | 'item_cap' | 'is_active'>>,
): SaleTax {
  const net = allocateDiscount(lines.map((l) => cents(l.lineTotal)), cents(Math.max(0, discount)))
  const qty4 = lines.map((l) => Math.round(Math.max(0, l.quantity) * 10000))
  // "raw" = cents × rate in ten-thousandths (1 unit = one millionth of a dollar).
  const lineRaw = lines.map(() => 0)
  const partRaw: number[] = []
  const partCents: number[] = []
  const parts: SaleTaxPart[] = []
  let rate10k = 0
  let sumRaw = 0

  for (const r of rates) {
    if (!r.is_active) continue
    const r10k = Math.round(r.rate * 10000)
    const capCents = r.item_cap == null ? null : Math.round(r.item_cap * 100)
    let base = 0
    for (let i = 0; i < net.length; i++) {
      let taxable = Math.max(0, net[i])
      if (capCents != null) taxable = Math.min(taxable, halfUp(capCents * qty4[i], 10000))
      base += taxable
      lineRaw[i] += taxable * r10k
    }
    rate10k += r10k
    sumRaw += base * r10k
    partRaw.push(base * r10k)
    partCents.push(halfUp(base * r10k, 10000))
    parts.push({ name: r.name, level: r.level, rate: r.rate, item_cap: r.item_cap, taxable: base / 100, tax: 0 })
  }

  // One rounding, on the whole sale.
  const taxCents = halfUp(sumRaw, 10000)

  // The tax lines add up to it: a leftover cent goes to the largest.
  const partFix = taxCents - partCents.reduce((a, b) => a + b, 0)
  if (partFix !== 0 && partCents.length > 0) partCents[largest(partRaw)] += partFix
  parts.forEach((p, i) => (p.tax = partCents[i] / 100))

  // So do the cart's lines.
  const lineCents = lineRaw.map((raw) => halfUp(raw, 10000))
  const lineFix = taxCents - lineCents.reduce((a, b) => a + b, 0)
  if (lineFix !== 0 && lineCents.length > 0) lineCents[largest(lineRaw)] += lineFix

  return {
    tax: taxCents / 100,
    rate: rate10k / 10000,
    net: net.map((c) => c / 100),
    lineTax: lineCents.map((c) => c / 100),
    parts,
  }
}

// ── The sale screen ───────────────────────────────────────────────────────

/** The shop's sales tax as the sale screen needs it. */
export type ShopTax = {
  /** Total percent as text, e.g. "7.5" — what the Tax field starts at. */
  percent: string
  /** Active tax lines, state first. */
  rates: TaxRate[]
}

/**
 * 'shop' while the Tax field still shows the shop's own rate: the sale is
 * taxed by the shop's tax lines, caps included (sale_create p_tax_mode).
 * 'flat' once the clerk types another rate (an exempt sale, a special case)
 * or when the shop has no tax lines: that one rate, on the whole sale.
 */
export function taxModeFor(taxFraction: number, shop: ShopTax | null | undefined): 'shop' | 'flat' {
  if (!shop || shop.rates.length === 0) return 'flat'
  return Math.abs(taxFraction - Number(shop.percent) / 100) < 1e-9 ? 'shop' : 'flat'
}

/**
 * Subtotal, discount, tax and total of a cart — the number on the Charge
 * button. Flat mode is computeTotal() unchanged.
 */
export function computeCartTotals(args: {
  lines: ReadonlyArray<CartLine>
  discount: number
  /** The Tax field, as a fraction (7.5% → 0.075). */
  taxFraction: number
  shop: ShopTax | null | undefined
}): CartTotals & { mode: 'shop' | 'flat' } {
  const lineTotals = args.lines.map((l) => computeLineTotal(l))
  const subtotal = lineTotals.reduce((acc, v) => r2(acc + v), 0)
  const mode = taxModeFor(args.taxFraction, args.shop)
  const flat = computeTotal({ subtotal, discount: args.discount, tax_rate: args.taxFraction })
  if (mode === 'flat' || !args.shop) return { ...flat, mode: 'flat' }

  const quote = quoteSaleTax(
    args.lines.map((l, i) => ({ quantity: Number(l.quantity) || 0, lineTotal: lineTotals[i] })),
    flat.discount,
    args.shop.rates,
  )
  return { ...flat, tax: quote.tax, total: r2(flat.taxableBase + quote.tax), mode: 'shop' }
}
