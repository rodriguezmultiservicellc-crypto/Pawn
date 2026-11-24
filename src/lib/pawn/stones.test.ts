import { describe, expect, it } from 'vitest'
import {
  MAX_STONES,
  blankStone,
  gemstoneText,
  normalizeStones,
  stonesToDrafts,
} from './stones'

const diamond = { qty: '3', type: 'diamond', carat: '0.75', color: 'white', cut: 'round', clarity: 'VS1' }

describe('normalizeStones', () => {
  it('reads the popup JSON and parses the numbers', () => {
    expect(normalizeStones(JSON.stringify([diamond]))).toEqual([
      { qty: 3, type: 'diamond', carat: 0.75, color: 'white', cut: 'round', clarity: 'VS1' },
    ])
  })

  it('takes an array as well as a string', () => {
    expect(normalizeStones([{ qty: 1, type: 'ruby' }])).toEqual([
      { qty: 1, type: 'ruby', carat: null, color: '', cut: '', clarity: '' },
    ])
  })

  it('drops a line with no words in it', () => {
    expect(normalizeStones([blankStone(), { ...blankStone(), qty: '2' }, { ...blankStone(), carat: '1' }])).toEqual([])
  })

  it('keeps a line that has only a cut or a color', () => {
    expect(normalizeStones([{ ...blankStone(), qty: '5', cut: 'baguette' }])).toHaveLength(1)
  })

  it('treats a zero, negative or unreadable number as not given', () => {
    const [s] = normalizeStones([{ qty: '0', type: 'opal', carat: 'abc' }])
    expect(s.qty).toBeNull()
    expect(s.carat).toBeNull()
    expect(normalizeStones([{ qty: '-2', type: 'opal', carat: '-1' }])[0]).toMatchObject({ qty: null, carat: null })
  })

  it('rounds the count to a whole number and carats to thousandths', () => {
    expect(normalizeStones([{ qty: '2.6', type: 'pearl', carat: '0.12345' }])[0]).toMatchObject({ qty: 3, carat: 0.123 })
  })

  it('tidies and cuts the text', () => {
    const [s] = normalizeStones([{ type: '  cubic   zirconia ', color: 'x'.repeat(80) }])
    expect(s.type).toBe('cubic zirconia')
    expect(s.color).toHaveLength(40)
  })

  it(`keeps at most ${MAX_STONES} stones`, () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ type: `stone ${i}` }))
    expect(normalizeStones(many)).toHaveLength(MAX_STONES)
  })

  it('never throws on junk', () => {
    expect(normalizeStones('')).toEqual([])
    expect(normalizeStones('not json')).toEqual([])
    expect(normalizeStones('{"a":1}')).toEqual([])
    expect(normalizeStones(null)).toEqual([])
    expect(normalizeStones(undefined)).toEqual([])
    expect(normalizeStones([null, 3, 'x', { type: { nested: true } }])).toEqual([])
  })
})

describe('gemstoneText', () => {
  it('writes one stone with everything', () => {
    expect(gemstoneText([diamond], '')).toBe('3 diamond (round, white, 0.75 ct, VS1)')
  })

  it('writes only what was filled', () => {
    expect(gemstoneText([{ ...blankStone(), type: 'ruby' }], '')).toBe('ruby')
    expect(gemstoneText([{ ...blankStone(), qty: '1', type: 'ruby', cut: 'oval' }], '')).toBe('1 ruby (oval)')
    expect(gemstoneText([{ ...blankStone(), cut: 'round', color: 'white' }], '')).toBe('round, white')
  })

  it('joins several stones and the notes', () => {
    expect(
      gemstoneText([diamond, { ...blankStone(), qty: '1', type: 'ruby', cut: 'oval' }], ' prong-set,  one chipped '),
    ).toBe('3 diamond (round, white, 0.75 ct, VS1); 1 ruby (oval); prong-set, one chipped')
  })

  it('is the notes alone when there are no stones', () => {
    expect(gemstoneText([], '3 round diamonds ~0.25ct each')).toBe('3 round diamonds ~0.25ct each')
    expect(gemstoneText(null, null)).toBe('')
  })

  it('reads the same from the popup JSON, the stored stones and the drafts', () => {
    const stored = normalizeStones([diamond])
    const expected = '3 diamond (round, white, 0.75 ct, VS1)'
    expect(gemstoneText(JSON.stringify([diamond]), '')).toBe(expected)
    expect(gemstoneText(stored, '')).toBe(expected)
    expect(gemstoneText(stonesToDrafts(stored), '')).toBe(expected)
  })
})

describe('stonesToDrafts', () => {
  it('puts stored stones back into the boxes', () => {
    expect(stonesToDrafts([{ qty: 3, type: 'diamond', carat: 0.75, color: 'white', cut: 'round', clarity: 'VS1' }])).toEqual([
      diamond,
    ])
  })

  it('is empty for an older row with no stones recorded', () => {
    expect(stonesToDrafts([])).toEqual([])
    expect(stonesToDrafts(null)).toEqual([])
  })
})
