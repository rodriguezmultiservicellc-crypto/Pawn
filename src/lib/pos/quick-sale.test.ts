import { describe, expect, it } from 'vitest'
import {
  addQuickSale,
  matchKey,
  nextUnit,
  quickSaleInputSchema,
  unitsLeft,
  unlinkedLine,
  type QuickLine,
} from './quick-sale'

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

describe('unlinkedLine (out of stock, added anyway)', () => {
  it('is a custom line with the item name and price, never linked to a unit', () => {
    expect(unlinkedLine('test ring', 200)).toEqual({
      inventory_item_id: null,
      description: 'test ring',
      quantity: '1',
      unit_price: '200.00',
      line_discount: '0',
      sku: null,
    })
  })
  it('defaults a missing price to 0 so staff type it in', () => {
    expect(unlinkedLine('x', null).unit_price).toBe('0.00')
  })
})

describe('product buttons (inventory-linked)', () => {
  const units = [
    { id: 'u1', sku: 'INV-000010', description: 'Watch battery 377', list_price: 15, category: 'other' },
    { id: 'u2', sku: 'INV-000011', description: 'Watch battery 377', list_price: 15, category: 'other' },
  ]
  const line = (id: string) => ({ inventory_item_id: id })

  it('matches on trimmed, lowercased description', () => {
    expect(matchKey('  Watch Battery 377 ')).toBe('watch battery 377')
  })
  it('takes the oldest unit not already in the cart', () => {
    expect(nextUnit(units, [])?.id).toBe('u1')
    expect(nextUnit(units, [line('u1')])?.id).toBe('u2')
    expect(nextUnit(units, [line('u1'), line('u2')])).toBeNull()
  })
  it('counts what is left outside the cart', () => {
    expect(unitsLeft(units, [])).toBe(2)
    expect(unitsLeft(units, [line('u2'), { inventory_item_id: null }])).toBe(1)
  })
})
