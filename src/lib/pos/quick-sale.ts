/**
 * Quick sale buttons (patches/0081-0082). Pure: the edit-form schema and the
 * cart rules for a tap.
 *
 * Two kinds of button:
 *   plain    name + price → an ordinary custom line; another tap raises its
 *            quantity.
 *   product  linked to inventory (0082). Every inventory row is one physical
 *            unit, so the product is "available units with this description
 *            and category". A tap adds the oldest unit not already in the cart
 *            as a normal inventory line, so the sale marks it sold like a scan.
 */

import { z } from 'zod'

export const QUICK_SALE_EDIT_ROLES = ['owner', 'chain_admin', 'manager'] as const
export const QUICK_SALE_MAX = 24

/** One sellable inventory unit (same shape as the POS inventory picker row). */
export type QuickUnit = {
  id: string
  sku: string
  description: string
  list_price: number | null
  category: string
}

export type QuickSaleButton =
  | { kind: 'plain'; id: string; name: string; price: number }
  | { kind: 'product'; id: string; name: string; units: QuickUnit[] }

export const quickSaleInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  price: z.coerce.number().min(0).max(1_000_000),
  is_active: z.boolean(),
})

export type QuickSaleInput = z.input<typeof quickSaleInputSchema>

/** Editing a button: a product button's price comes from its units, so price is optional. */
export const quickSaleUpdateSchema = quickSaleInputSchema.extend({
  price: quickSaleInputSchema.shape.price.optional(),
})

export type QuickSaleUpdate = z.input<typeof quickSaleUpdateSchema>

/** A product button is created from one inventory unit; its name defaults to that unit's description. */
export const quickSaleProductInputSchema = z.object({
  inventory_item_id: z.string().uuid(),
  name: z.string().trim().max(60).optional(),
})

/** The stock key a product button matches on — the same rule as the 0082 CHECK. */
export function matchKey(description: string): string {
  return description.trim().toLowerCase()
}

/** The cart line fields a tap touches. */
export type QuickLine = {
  inventory_item_id: string | null
  description: string
  quantity: string
  unit_price: string
  line_discount: string
  sku: string | null
  /** Which plain button made this line (UI only; never sent to the server). */
  quick_sale_id?: string | null
}

/**
 * Plain button: first tap adds a custom line with the button's name and
 * price; another tap on the same button raises that line's quantity by one.
 */
export function addQuickSale(lines: QuickLine[], b: { id: string; name: string; price: number }): QuickLine[] {
  const idx = lines.findIndex((l) => l.quick_sale_id === b.id)
  if (idx >= 0) {
    return lines.map((l, i) =>
      i === idx ? { ...l, quantity: String((parseFloat(l.quantity) || 0) + 1) } : l,
    )
  }
  return [
    ...lines,
    {
      inventory_item_id: null,
      description: b.name,
      quantity: '1',
      unit_price: b.price.toFixed(2),
      line_discount: '0',
      sku: null,
      quick_sale_id: b.id,
    },
  ]
}

/** Product button: the oldest unit not already in the cart, or null when none is left. */
export function nextUnit<U extends { id: string }>(units: U[], lines: Pick<QuickLine, 'inventory_item_id'>[]): U | null {
  const inCart = new Set(lines.map((l) => l.inventory_item_id).filter(Boolean))
  return units.find((u) => !inCart.has(u.id)) ?? null
}

export function unitsLeft(units: { id: string }[], lines: Pick<QuickLine, 'inventory_item_id'>[]): number {
  const inCart = new Set(lines.map((l) => l.inventory_item_id).filter(Boolean))
  return units.filter((u) => !inCart.has(u.id)).length
}
