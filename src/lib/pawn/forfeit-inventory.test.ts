import { describe, expect, it } from 'vitest'
import { inventoryDetailsFromCollateral, type ForfeitedCollateral } from './forfeit-inventory'

const blank: ForfeitedCollateral = {
  coating: 'none',
  jewelry_brand: null,
  jewelry_model: null,
  jewelry_serial: null,
  electronic_brand: null,
  electronic_model: null,
  electronic_serial: null,
  tool_brand: null,
  tool_model: null,
  tool_serial: null,
  general_brand: null,
  general_model: null,
  general_serial: null,
  firearm_make: null,
  firearm_model: null,
  firearm_serial_number: null,
  stones: [],
  gemstone_notes: null,
}
const d = (over: Partial<ForfeitedCollateral>) => inventoryDetailsFromCollateral({ ...blank, ...over })

describe('a forfeited item carries its brand, model and serial into inventory', () => {
  it('from a watch', () => {
    expect(d({ jewelry_brand: 'Rolex', jewelry_model: 'Submariner 16610', jewelry_serial: ' X123456 ' })).toMatchObject({
      brand: 'Rolex',
      model: 'Submariner 16610',
      serial_number: 'X123456',
    })
  })

  it('from electronics, a tool, a general item and a firearm', () => {
    expect(d({ electronic_brand: 'Apple', electronic_model: 'iPhone 13', electronic_serial: 'IMEI1' }).serial_number).toBe('IMEI1')
    expect(d({ tool_brand: 'DeWalt', tool_model: 'DCD777', tool_serial: 'T-9' })).toMatchObject({
      brand: 'DeWalt',
      model: 'DCD777',
      serial_number: 'T-9',
    })
    expect(d({ general_brand: 'Yamaha', general_model: 'P-45', general_serial: 'G-1' })).toMatchObject({
      brand: 'Yamaha',
      model: 'P-45',
      serial_number: 'G-1',
    })
    expect(d({ firearm_make: 'Glock', firearm_model: '19', firearm_serial_number: 'ABC' })).toMatchObject({
      brand: 'Glock',
      model: '19',
      serial_number: 'ABC',
    })
  })

  it('leaves them empty for a plain chain, and treats blanks as nothing', () => {
    expect(d({})).toMatchObject({ brand: null, model: null, serial_number: null })
    expect(d({ jewelry_brand: '  ', tool_brand: 'DeWalt' }).brand).toBe('DeWalt')
  })
})

describe('a forfeited item keeps its coating', () => {
  it('so a plated piece does not arrive in inventory as solid', () => {
    expect(d({ coating: 'gold_plated' }).coating).toBe('gold_plated')
    expect(d({ coating: 'vermeil' }).coating).toBe('vermeil')
  })

  it('and anything unreadable counts as solid, as the column defaults', () => {
    expect(d({ coating: null }).coating).toBe('none')
    expect(d({ coating: 'chrome' }).coating).toBe('none')
  })
})

describe('a forfeited item keeps its stones', () => {
  it('one inventory stone per line, in order', () => {
    const out = d({
      stones: [
        { qty: 3, type: 'diamond', carat: 0.75, color: 'white', cut: 'round', clarity: 'VS1' },
        { qty: null, type: 'ruby', carat: null, color: '', cut: 'oval', clarity: '' },
      ],
      gemstone_notes: ' prong-set ',
    })
    expect(out.stones).toEqual([
      { position: 0, count: 3, stone_type: 'diamond', carat: 0.75, color: 'white', cut: 'round', clarity: 'VS1' },
      { position: 1, count: 1, stone_type: 'ruby', carat: null, color: null, cut: 'oval', clarity: null },
    ])
    expect(out.stoneNotes).toBe('prong-set')
  })

  it('none for an older or imported ticket', () => {
    expect(d({ stones: [] }).stones).toEqual([])
    expect(d({ stones: null }).stones).toEqual([])
    expect(d({ stones: 'junk' }).stones).toEqual([])
    expect(d({ gemstone_notes: '' }).stoneNotes).toBeNull()
  })
})
