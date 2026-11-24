import { describe, expect, it } from 'vitest'
import {
  descriptionAfterChange,
  generateItemDescription,
  type ItemDescriptionInput,
  type ItemDescriptionWords,
} from './item-description'

const EN: ItemDescriptionWords = {
  jewelryOrder: '{karat} {color} {metal} {item}',
  ringSize: 'size {v}',
}
const ES: ItemDescriptionWords = {
  jewelryOrder: '{item} {metal} {color} {karat}',
  ringSize: 'talla {v}',
}

const blank: ItemDescriptionInput = {
  kind: 'jewelry',
  itemWord: '',
  isRing: false,
  color: '',
  metalWord: '',
  karat: '',
  weightGrams: '',
  size: '',
  coatingWord: '',
  gemstones: '',
  firearmMake: '',
  firearmModel: '',
  firearmCaliber: '',
  firearmTypeWord: '',
  firearmFinish: '',
  electronicBrand: '',
  electronicModel: '',
  toolBrand: '',
  toolModel: '',
}
const gen = (over: Partial<ItemDescriptionInput>, words = EN) =>
  generateItemDescription({ ...blank, ...over }, words)

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
    // A chain's bare number is left as typed; so is a ring size with words.
    expect(gen({ itemWord: 'Chain', metalWord: 'Gold', size: '22' })).toBe('Gold chain, 22')
    expect(gen({ itemWord: 'Ring', isRing: true, metalWord: 'Gold', size: 'US 7' })).toBe(
      'Gold ring, US 7',
    )
  })

  it('leaves out a karat or weight of zero', () => {
    expect(gen({ itemWord: 'Chain', metalWord: 'Silver', karat: '0', weightGrams: '0' })).toBe(
      'Silver chain',
    )
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

  it('puts the words in Spanish order', () => {
    expect(
      gen(
        {
          itemWord: 'Cadena',
          color: 'Amarillo',
          metalWord: 'Oro',
          karat: '14',
          weightGrams: '5.2',
        },
        ES,
      ),
    ).toBe('Cadena oro amarillo 14K, 5.2 g')
    expect(gen({ itemWord: 'Anillo', isRing: true, metalWord: 'Oro', size: '7' }, ES)).toBe(
      'Anillo oro, talla 7',
    )
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

  it('writes nothing for a category with no fields of its own', () => {
    expect(gen({ kind: 'other', color: 'Red', itemWord: 'Bike' })).toBe('')
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
