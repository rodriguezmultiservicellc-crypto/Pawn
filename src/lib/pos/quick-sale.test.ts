import { describe, expect, it } from 'vitest'
import { addQuickSale, quickSaleInputSchema, type QuickLine } from './quick-sale'

const battery = { id: 'b1', name: 'Battery swap', price: 15 }
const clean = { id: 'b2', name: 'Cleaning', price: 7.5 }

describe('addQuickSale', () => {
  it('adds a custom line with the button name and price', () => {
    const out = addQuickSale([], battery)
    expect(out).toEqual([
      { inventory_item_id: null, description: 'Battery swap', quantity: '1', unit_price: '15.00', line_discount: '0', sku: null, quick_sale_id: 'b1' },
    ])
  })
  it('a second tap raises the quantity instead of adding a line', () => {
    const out = addQuickSale(addQuickSale(addQuickSale([], battery), clean), battery)
    expect(out).toHaveLength(2)
    expect(out[0].quantity).toBe('2')
    expect(out[1].quantity).toBe('1')
  })
  it('never merges into a hand-typed custom line or an inventory line', () => {
    const typed: QuickLine = { inventory_item_id: null, description: 'Battery swap', quantity: '1', unit_price: '15', line_discount: '0', sku: null }
    expect(addQuickSale([typed], battery)).toHaveLength(2)
  })
})

describe('quickSaleInputSchema', () => {
  it('trims the name and refuses blank names and negative prices', () => {
    expect(quickSaleInputSchema.parse({ name: '  Sizing ', price: '20', is_active: true })).toEqual({ name: 'Sizing', price: 20, is_active: true })
    expect(quickSaleInputSchema.safeParse({ name: '  ', price: 1, is_active: true }).success).toBe(false)
    expect(quickSaleInputSchema.safeParse({ name: 'x', price: -1, is_active: true }).success).toBe(false)
  })
})
