/**
 * Return / refund math. Pure — unit-tested in returns.test.ts, shared by the
 * server action (which decides the real refund) and the return screen (which
 * previews it), so the clerk sees the number that will be written.
 *
 * What a refund is worth
 * ----------------------
 * The customer gets back what they actually paid for the returned goods:
 *
 *   merchandise  = Σ line_total × (qty returned ÷ qty sold)
 *                  (line_total is already net of the line discount)
 *   discount     = the sale's cart-level discount × merchandise ÷ sale subtotal
 *                  (loyalty redemptions live in the same column)
 *   tax          = the sale's tax × the same share
 *   total        = merchandise − discount + tax
 *
 * It is never `quantity × unit_price`: that ignores every discount and the
 * tax, so a $100 item sold for $70 + tax refunded $100.
 *
 * Two hard limits
 * ---------------
 *   - A refund can never exceed what was paid and not yet refunded:
 *       cap = min(sale.total, sale.paid_total) − sale.returned_total
 *   - When a return takes back everything that is left on the sale, the
 *     refund is exactly that remaining cap, so rounding across several
 *     partial returns can never leave the sale a fraction short of (or over)
 *     "fully returned".
 */

import { r4, toMoney } from './cart'
import type { SaleStatus } from '@/types/database-aliases'

type Money = number | string | null | undefined

/** Only a sale that was completed (and paid) can be returned against. */
export function isReturnableSaleStatus(status: SaleStatus | string): boolean {
  return status === 'completed' || status === 'partial_returned'
}

export type ReturnSaleTotals = {
  subtotal: Money
  discount_amount: Money
  tax_amount: Money
  total: Money
  paid_total: Money
  returned_total: Money
}

/** One line of the ORIGINAL sale, with how much of it this return takes. */
export type ReturnLine = {
  /** sale_items.quantity */
  sold_quantity: Money
  /** sale_items.returned_qty before this return */
  already_returned: Money
  /** sale_items.line_total (net of line_discount) */
  line_total: Money
  /** Quantity being returned now. 0 for lines not in this return. */
  return_quantity: number
}

export type ReturnRefund = {
  /** Value of the returned goods, net of line discounts, before the cart
   *  discount share and tax. Basis for the loyalty clawback. */
  merchandise: number
  /** Share of the sale's cart-level discount that these goods carried. */
  discount: number
  /** returns.subtotal — merchandise − discount. */
  subtotal: number
  /** returns.tax_amount */
  tax: number
  /** returns.total / refunded_total — what the customer gets back. */
  total: number
  /** Per input line: the net value returned (return_items.line_total). */
  lineValues: number[]
  /** True when this return leaves nothing more to return on the sale. */
  isFinal: boolean
  /** True when the computed refund had to be cut down to the cap. */
  capped: boolean
}

const EPS = 0.0001

/**
 * @param args.lines EVERY line of the sale (return_quantity 0 for the ones
 *   not being returned) — needed to know whether this return is the last.
 */
export function computeReturnRefund(args: {
  sale: ReturnSaleTotals
  lines: ReadonlyArray<ReturnLine>
}): ReturnRefund {
  const sale = {
    subtotal: toMoney(args.sale.subtotal),
    discount: Math.max(0, toMoney(args.sale.discount_amount)),
    tax: Math.max(0, toMoney(args.sale.tax_amount)),
    total: toMoney(args.sale.total),
    paid: toMoney(args.sale.paid_total),
    returned: toMoney(args.sale.returned_total),
  }

  let merchandise = 0
  let lineSum = 0
  let isFinal = args.lines.length > 0
  const lineValues: number[] = []

  for (const ln of args.lines) {
    const sold = toMoney(ln.sold_quantity)
    const already = toMoney(ln.already_returned)
    const lineTotal = toMoney(ln.line_total)
    const remaining = r4(Math.max(0, sold - already))
    const qty = r4(Math.min(Math.max(0, ln.return_quantity), remaining))
    lineSum = r4(lineSum + lineTotal)

    const value = sold > 0 ? r4((lineTotal * qty) / sold) : 0
    lineValues.push(value)
    merchandise = r4(merchandise + value)

    if (remaining - qty > EPS) isFinal = false
  }

  // Share of the sale these goods represent. Prefer the stored subtotal; fall
  // back to the sum of the lines if a row was written without one.
  const base = sale.subtotal > 0 ? sale.subtotal : lineSum
  const share = base > 0 ? Math.min(1, merchandise / base) : 0
  const discount = r4(sale.discount * share)
  const rawTax = r4(sale.tax * share)

  const cap = r4(Math.max(0, Math.min(sale.total, sale.paid) - sale.returned))
  const raw = r4(Math.max(0, merchandise - discount + rawTax))

  let total: number
  let capped = false
  if (merchandise <= 0) {
    total = 0
    isFinal = false
  } else if (isFinal) {
    // Taking back everything that is left: refund exactly what remains.
    total = cap
    capped = raw > cap + EPS
  } else if (raw > cap) {
    total = cap
    capped = true
  } else {
    total = raw
  }

  // Keep subtotal + tax = total after any adjustment.
  let subtotal = r4(Math.max(0, merchandise - discount))
  let tax: number
  if (total < subtotal) {
    subtotal = total
    tax = 0
  } else {
    tax = r4(total - subtotal)
  }

  return {
    merchandise,
    discount,
    subtotal,
    tax,
    total,
    lineValues,
    isFinal,
    capped,
  }
}
