/**
 * POS cart math — the on-screen mirror of sale_create() (patches/0076).
 *
 * Money a customer is charged is in CENTS: line totals, the cart discount,
 * tax and the total are each rounded to 2 places, exactly as the database
 * computes them, so the screen, the receipt and the card charge agree
 * (REVIEW-2026-11-11 finding 16). Storage stays numeric(18,4).
 *
 * NOTE: r4 / toMoney mirror the helpers in lib/pawn/math.ts. They live here
 * too so the POS surface has a single import path and so client components
 * can pull cart math without dragging the pawn module along.
 */

const SCALE = 10000

/** Round to 4 decimal places. */
export function r4(n: number): number {
  if (!isFinite(n)) return 0
  return Math.round(n * SCALE) / SCALE
}

/** Round to cents. Half away from zero, like Postgres ROUND(numeric, 2). */
export function r2(n: number): number {
  if (!isFinite(n)) return 0
  const sign = n < 0 ? -1 : 1
  // The 1e-9 nudge absorbs binary noise (1.005 is stored as 1.00499…).
  return (sign * Math.round(Math.abs(n) * 100 + 1e-9)) / 100
}

/** Coerce a string|number|null|undefined money value to a Number rounded to 4dp. */
export function toMoney(v: string | number | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return r4(n)
}

export type CartLine = {
  quantity: number | string | null
  unit_price: number | string | null
  line_discount: number | string | null
}

/**
 * Per-line total in cents: (unit_price × quantity) − line_discount, floored
 * at 0. Unit price and discount are cents too.
 */
export function computeLineTotal(line: CartLine): number {
  const qty = toMoney(line.quantity)
  const unit = r2(toMoney(line.unit_price))
  const disc = r2(toMoney(line.line_discount))
  return Math.max(0, r2(qty * unit - disc))
}

/**
 * Sum of computed line totals.
 */
export function computeSubtotal(lines: ReadonlyArray<CartLine>): number {
  let acc = 0
  for (const line of lines) {
    acc = r2(acc + computeLineTotal(line))
  }
  return acc
}

export type CartTotals = {
  subtotal: number
  discount: number
  taxableBase: number
  tax: number
  total: number
}

/**
 * Compute the full set of totals for a cart.
 *
 * Convention:
 *   tax = (subtotal − discount) × tax_rate
 *   total = subtotal − discount + tax
 *
 * Discount applies to the whole cart (separate from per-line line_discount,
 * which is already netted into each line's contribution to subtotal).
 */
export function computeTotal(args: {
  subtotal: number
  discount?: number | null
  tax_rate?: number | null
}): CartTotals {
  const subtotal = r2(args.subtotal)
  const discount = r2(Math.max(0, toMoney(args.discount ?? 0)))
  const taxableBase = r2(Math.max(0, subtotal - discount))
  const taxRate = toMoney(args.tax_rate ?? 0)
  const tax = r2(taxableBase * taxRate)
  const total = r2(taxableBase + tax)
  return { subtotal, discount, taxableBase, tax, total }
}

/**
 * Remaining balance for a sale in cents: total − paid_total, floored at 0.
 * The total is rounded first, as sale_complete() does, so an older sale
 * stored with 4 decimals (21.3144) is payable as 21.31.
 */
export function computeBalance(sale: {
  total: number | string | null
  paid_total: number | string | null
}): number {
  const total = r2(toMoney(sale.total))
  const paid = toMoney(sale.paid_total)
  return Math.max(0, r2(total - paid))
}

/**
 * Returnable quantity for a sale_item: original quantity − returned_qty,
 * floored at 0.
 */
export function returnableQty(item: {
  quantity: number | string | null
  returned_qty: number | string | null
}): number {
  const total = toMoney(item.quantity)
  const ret = toMoney(item.returned_qty)
  return r4(Math.max(0, total - ret))
}
