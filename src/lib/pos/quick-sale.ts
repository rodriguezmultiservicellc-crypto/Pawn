/**
 * Quick sale buttons (patches/0081). Pure: the edit-form schema and the
 * cart rule for a tap. A button becomes an ordinary custom line (no
 * inventory item), so saving the sale is unchanged.
 */

import { z } from 'zod'

export const QUICK_SALE_EDIT_ROLES = ['owner', 'chain_admin', 'manager'] as const
export const QUICK_SALE_MAX = 24

export type QuickSaleButton = { id: string; name: string; price: number }

export const quickSaleInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  price: z.coerce.number().min(0).max(1_000_000),
  is_active: z.boolean(),
})

export type QuickSaleInput = z.input<typeof quickSaleInputSchema>

/** The cart line fields a tap touches. */
export type QuickLine = {
  inventory_item_id: string | null
  description: string
  quantity: string
  unit_price: string
  line_discount: string
  sku: string | null
  /** Which button made this line (UI only; never sent to the server). */
  quick_sale_id?: string | null
}

/**
 * First tap adds a custom line with the button's name and price; another tap
 * on the same button raises that line's quantity by one.
 */
export function addQuickSale(lines: QuickLine[], b: QuickSaleButton): QuickLine[] {
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
