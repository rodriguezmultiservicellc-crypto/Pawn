import { describe, expect, it } from 'vitest'
import {
  descriptionAfterChange,
  generateItemDescription,
  isLengthPiece,
  type ItemDescriptionInput,
} from './item-description'

const blank: ItemDescriptionInput = {
  kind: 'jewelry',
  itemWord: '',
  isRing: false,
  isLength: false,
  color: '',
  metalWord: '',
  metal: '',
  karat: '',
  weightGrams: '',
  size: '',
  coatingWord: '',
  gemstones: '',
  gender: '',
  style: '',
  jewelryBrand: '',
  jewelryModel: '',
  firearmMake: '',
  firearmModel: '',
  firearmCaliber: '',
  firearmTypeWord: '',
  firearmFinish: '',
  electronicBrand: '',
  electronicModel: '',
  toolBrand: '',
  toolModel: '',
  generalBrand: '',
  generalModel: '',
}
const gen = (over: Partial<ItemDescriptionInput>) =>
  generateItemDescription({ ...blank, ...over })

describe('jewelry', () => {
  it('is empty with only the category picked', () => {
    expect(gen({ itemWord: 'Chain' })).toBe('')
  })

  it('grows as the fields are filled, in the order the clerk fills them', () => {
    const chain = { itemWord: 'Chain' }
    expect(gen({ ...chain, color: 'Yellow' })).toBe('Yellow chain')
    expect(gen({ ...chain, color: 'Yellow', metalWord: 'Gold' })).toBe('Yellow gold chain')
    expect(gen({ ...chain, color: 'Yellow', metalWord: 'Gold', karat: '14' })).toBe(
      '14K yellow gold chain',
    )
    expect(
      gen({ ...chain, color: 'Yellow', metalWord: 'Gold', karat: '14', weightGrams: '5.2' }),
    ).toBe('14K yellow gold chain, 5.2 g')
    expect(
      gen({
        ...chain,
        color: 'Yellow',
        metalWord: 'Gold',
        karat: '14',
        weightGrams: '5.2',
        size: '22 in',
        gemstones: '3 round diamonds ~0.25ct each',
      }),
    ).toBe('14K yellow gold chain, 5.2 g, 22 in, 3 round diamonds ~0.25ct each')
  })

  it('names the coating when the piece is not solid', () => {
    expect(
      gen({ itemWord: 'Bracelet', metalWord: 'Gold', coatingWord: 'Gold plated', weightGrams: '9' }),
    ).toBe('Gold bracelet, 9 g, gold plated')
    expect(gen({ itemWord: 'Ring', coatingWord: 'PVD' })).toBe('Ring, PVD')
  })

  it('reads a bare number on a ring as its size', () => {
    expect(gen({ itemWord: 'Ring', isRing: true, karat: '18', metalWord: 'White gold', size: '7' })).toBe(
      '18K white gold ring, size 7',
    )
    expect(gen({ itemWord: 'Ring', isRing: true, metalWord: 'Gold', size: '7.5' })).toBe(
      'Gold ring, size 7.5',
    )
    // A ring size with words is left as typed; so is the bare number of a
    // piece that is neither a ring nor a length (a pendant).
    expect(gen({ itemWord: 'Pendant', metalWord: 'Gold', size: '22' })).toBe('Gold pendant, 22')
    expect(gen({ itemWord: 'Ring', isRing: true, metalWord: 'Gold', size: 'US 7' })).toBe(
      'Gold ring, US 7',
    )
  })

  it('reads a bare number on a chain, necklace or bracelet as inches', () => {
    const chain = { itemWord: 'Chain', isLength: true, metalWord: 'Gold' }
    expect(gen({ ...chain, weightGrams: '45', size: '22' })).toBe('Gold chain, 45 g, 22 in')
    expect(gen({ itemWord: 'Bracelet', isLength: true, metalWord: 'Gold', size: '7.5' })).toBe(
      'Gold bracelet, 7.5 in',
    )
    // A length typed with its own unit is left as typed.
    expect(gen({ ...chain, size: '55 cm' })).toBe('Gold chain, 55 cm')
    expect(gen({ ...chain, size: '22 in' })).toBe('Gold chain, 22 in')
    expect(gen({ ...chain, size: '22"' })).toBe('Gold chain, 22"')
  })

  it('isLengthPiece: chains, necklaces and bracelets', () => {
    expect(['chain', 'necklace', 'bracelet'].map(isLengthPiece)).toEqual([true, true, true])
    expect(['ring', 'pendant', 'earrings', 'watch', 'other', '', null].map(isLengthPiece)).toEqual(
      Array(7).fill(false),
    )
  })

  it('leaves out a karat or weight of zero', () => {
    expect(gen({ itemWord: 'Chain', metalWord: 'Silver', karat: '0', weightGrams: '0' })).toBe(
      'Silver chain',
    )
  })

  it('writes silver and platinum in parts per thousand, never as karats', () => {
    expect(gen({ itemWord: 'Chain', metal: 'silver', metalWord: 'Silver', karat: '925' })).toBe(
      '925 silver chain',
    )
    expect(gen({ itemWord: 'Ring', metal: 'platinum', metalWord: 'Platinum', karat: '950' })).toBe(
      '950 platinum ring',
    )
    expect(gen({ itemWord: 'Ring', metal: 'gold', metalWord: 'Gold', karat: '14' })).toBe('14K gold ring')
  })

  it('works without an item word', () => {
    expect(gen({ metalWord: 'Gold', karat: '10' })).toBe('10K gold')
  })

  it('tidies spaces and capital letters', () => {
    expect(gen({ itemWord: 'Chain', color: '  TWO-TONE ', metalWord: 'Rose gold' })).toBe(
      'TWO-TONE rose gold chain',
    )
    expect(gen({ itemWord: 'Chain', color: 'Two-Tone', metalWord: 'Rose gold' })).toBe(
      'Two-tone rose gold chain',
    )
  })

})

describe('jewelry: gender, style, brand', () => {
  it('puts the gender and the style before the item', () => {
    expect(
      gen({
        itemWord: 'Chain',
        color: 'Yellow',
        metalWord: 'Gold',
        karat: '14',
        gender: 'men',
        style: 'Cuban Link',
        weightGrams: '22',
      }),
    ).toBe("14K yellow gold men's cuban link chain, 22 g")
  })

  it('writes with the gender or the style alone', () => {
    expect(gen({ itemWord: 'Ring', gender: 'women' })).toBe("Women's ring")
    expect(gen({ itemWord: 'Ring', style: 'Solitaire' })).toBe('Solitaire ring')
  })

  it('leads with the brand and model of a watch, as typed', () => {
    expect(
      gen({
        itemWord: 'Watch',
        jewelryBrand: 'Rolex',
        jewelryModel: 'Submariner 16610',
        metalWord: 'Stainless steel',
        gender: 'men',
      }),
    ).toBe("Rolex Submariner 16610, stainless steel men's watch")
    expect(gen({ itemWord: 'Watch', jewelryBrand: 'Gucci' })).toBe('Gucci, watch')
  })

})

describe('other kinds', () => {
  it('writes an electronic from brand and model', () => {
    const e = { kind: 'electronics' as const }
    expect(gen({ ...e, color: 'Black' })).toBe('')
    expect(gen({ ...e, electronicBrand: 'Apple' })).toBe('Apple')
    expect(gen({ ...e, electronicBrand: 'Apple', electronicModel: 'iPhone 13 Pro', color: 'Black' })).toBe(
      'Apple iPhone 13 Pro, black',
    )
  })

  it('writes a tool from brand and model', () => {
    expect(gen({ kind: 'tools', toolBrand: 'DeWalt', toolModel: 'DCD777', color: 'Yellow' })).toBe(
      'DeWalt DCD777, yellow',
    )
  })

  it('writes a firearm from make, model, caliber and type', () => {
    const f = { kind: 'firearms' as const }
    expect(gen({ ...f, firearmFinish: 'Blued' })).toBe('')
    expect(
      gen({
        ...f,
        firearmMake: 'Glock',
        firearmModel: '19 Gen 5',
        firearmCaliber: '9mm',
        firearmTypeWord: 'Handgun',
        firearmFinish: 'Blued',
      }),
    ).toBe('Glock 19 Gen 5, 9mm handgun, blued')
  })

  it('writes a general item from its brand and model, and nothing without them', () => {
    expect(gen({ kind: 'other', color: 'Red', itemWord: 'Bike' })).toBe('')
    expect(
      gen({ kind: 'other', generalBrand: 'Yamaha', generalModel: 'P-45', size: '88 keys', color: 'Black' }),
    ).toBe('Yamaha P-45, 88 keys, black')
  })

  it('adds the size of an electronic or a tool', () => {
    expect(
      gen({ kind: 'electronics', electronicBrand: 'Samsung', electronicModel: 'UN55', size: '55 in', color: 'Black' }),
    ).toBe('Samsung UN55, 55 in, black')
    expect(gen({ kind: 'tools', toolBrand: 'DeWalt', toolModel: 'DCD777', size: '20V' })).toBe(
      'DeWalt DCD777, 20V',
    )
  })

  it('is written in English whatever the screen language (FS 539.001(8)(a))', () => {
    expect(gen({ itemWord: 'Chain', gender: 'child', karat: '10', metalWord: 'Gold' })).toBe(
      "10K gold child's chain",
    )
    expect(gen({ itemWord: 'Ring', isRing: true, metalWord: 'Gold', size: '7' })).toBe('Gold ring, size 7')
  })
})

describe('descriptionAfterChange', () => {
  it('fills an empty description', () => {
    expect(descriptionAfterChange('', '', 'Yellow chain')).toBe('Yellow chain')
  })

  it('keeps following while the clerk has not touched it', () => {
    expect(descriptionAfterChange('Yellow chain', 'Yellow chain', 'Yellow gold chain')).toBe(
      'Yellow gold chain',
    )
  })

  it('leaves alone a description the clerk wrote', () => {
    expect(descriptionAfterChange('Rope chain, dented clasp', 'Yellow chain', 'Yellow gold chain')).toBe(
      'Rope chain, dented clasp',
    )
  })

  it('takes over again once the clerk clears it', () => {
    expect(descriptionAfterChange('  ', 'Yellow chain', 'Yellow gold chain')).toBe('Yellow gold chain')
  })

  it('changes nothing when the change did not touch the description', () => {
    expect(descriptionAfterChange('', 'Yellow chain', 'Yellow chain')).toBe('')
    expect(descriptionAfterChange('Mine', 'Yellow chain', 'Yellow chain')).toBe('Mine')
  })

  it('empties with the fields when it was still the written one', () => {
    expect(descriptionAfterChange('Yellow chain', 'Yellow chain', '')).toBe('')
  })
})
