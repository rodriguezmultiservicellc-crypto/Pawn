/**
 * POS cart math. Decimal-safe within JS Number precision: every intermediate
 * result is rounded to 4 decimal places (matching `numeric(18,4)` columns).
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
 * Per-line total: (unit_price × quantity) − line_discount, floored at 0.
 */
export function computeLineTotal(line: CartLine): number {
  const qty = toMoney(line.quantity)
  const unit = toMoney(line.unit_price)
  const disc = toMoney(line.line_discount)
  const gross = r4(qty * unit)
  return r4(Math.max(0, gross - disc))
}

/**
 * Sum of computed line totals.
 */
export function computeSubtotal(lines: ReadonlyArray<CartLine>): number {
  let acc = 0
  for (const line of lines) {
    acc = r4(acc + computeLineTotal(line))
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
  const subtotal = r4(args.subtotal)
  const discount = r4(Math.max(0, toMoney(args.discount ?? 0)))
  const taxableBase = r4(Math.max(0, subtotal - discount))
  const taxRate = toMoney(args.tax_rate ?? 0)
  const tax = r4(taxableBase * taxRate)
  const total = r4(taxableBase + tax)
  return { subtotal, discount, taxableBase, tax, total }
}

/**
 * Remaining balance for a sale: total − paid_total, floored at 0.
 */
export function computeBalance(sale: {
  total: number | string | null
  paid_total: number | string | null
}): number {
  const total = toMoney(sale.total)
  const paid = toMoney(sale.paid_total)
  return r4(Math.max(0, total - paid))
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
