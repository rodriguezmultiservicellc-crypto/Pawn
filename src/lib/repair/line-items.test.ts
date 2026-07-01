import { describe, it, expect } from 'vitest'
import {
  composeLineItemTitle,
  normalizeWeightGrams,
  deriveItemDescription,
  deriveTicketTitle,
  itemTypeLabelEn,
} from './line-items'

describe('normalizeWeightGrams', () => {
  it('drops trailing zeros', () => {
    expect(normalizeWeightGrams('2.80')).toBe('2.8')
    expect(normalizeWeightGrams('3.00')).toBe('3')
    expect(normalizeWeightGrams(2.8)).toBe('2.8')
  })
  it('returns empty for absent / non-positive / non-finite', () => {
    expect(normalizeWeightGrams('')).toBe('')
    expect(normalizeWeightGrams(null)).toBe('')
    expect(normalizeWeightGrams(undefined)).toBe('')
    expect(normalizeWeightGrams('0')).toBe('')
    expect(normalizeWeightGrams(-1)).toBe('')
    expect(normalizeWeightGrams('abc')).toBe('')
  })
})

describe('composeLineItemTitle', () => {
  it('composes the full example', () => {
    expect(
      composeLineItemTitle({
        typeLabel: 'Necklace',
        karat: '14k',
        weightGrams: 2.8,
        dimension: '18"',
      }),
    ).toBe('Necklace · 14k · 2.8g · 18"')
  })
  it('drops missing segments', () => {
    expect(composeLineItemTitle({ typeLabel: 'Ring', karat: '14k' })).toBe(
      'Ring · 14k',
    )
    expect(
      composeLineItemTitle({ typeLabel: 'Ring', dimension: 'sz 7' }),
    ).toBe('Ring · sz 7')
  })
  it('trims and returns empty when nothing set', () => {
    expect(composeLineItemTitle({})).toBe('')
    expect(composeLineItemTitle({ typeLabel: '  ' })).toBe('')
  })
})

describe('itemTypeLabelEn', () => {
  it('maps known values, falls back to Item', () => {
    expect(itemTypeLabelEn('necklace')).toBe('Necklace')
    expect(itemTypeLabelEn('other')).toBe('Item')
    expect(itemTypeLabelEn('nonsense')).toBe('Item')
  })
})

describe('deriveItemDescription', () => {
  it('joins one line per item with work appended', () => {
    expect(
      deriveItemDescription([
        { title: 'Necklace · 14k · 2.8g · 18"', work_needed: 'solder by clasp' },
        { title: 'Ring · 14k · sz 7', work_needed: null },
      ]),
    ).toBe('Necklace · 14k · 2.8g · 18" — solder by clasp\nRing · 14k · sz 7')
  })
  it('trims blank work', () => {
    expect(
      deriveItemDescription([{ title: 'Ring', work_needed: '   ' }]),
    ).toBe('Ring')
  })
})

describe('deriveTicketTitle', () => {
  it('single item passes through', () => {
    expect(deriveTicketTitle([{ title: 'Necklace · 14k' }])).toBe(
      'Necklace · 14k',
    )
  })
  it('appends (+N) for extra items', () => {
    expect(
      deriveTicketTitle([{ title: 'Necklace' }, { title: 'Ring' }, { title: 'Chain' }]),
    ).toBe('Necklace (+2)')
  })
  it('empty list → empty', () => {
    expect(deriveTicketTitle([])).toBe('')
  })
})
