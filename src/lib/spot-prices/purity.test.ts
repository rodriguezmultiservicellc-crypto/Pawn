import { describe, expect, it } from 'vitest'
import {
  defaultPurityFor,
  isValidPurity,
  purityChoicesFor,
  purityContentRatio,
  purityFromItem,
  purityFromWords,
  purityScaleOf,
  purityText,
} from './purity'

describe('purity: karats for gold, parts per thousand for silver and platinum', () => {
  it('knows how each metal is written', () => {
    expect(purityScaleOf('gold')).toBe('karat')
    expect(purityScaleOf('white_gold')).toBe('karat')
    expect(purityScaleOf('mixed')).toBe('karat')
    expect(purityScaleOf('')).toBe('karat')
    expect(purityScaleOf('silver')).toBe('fineness')
    expect(purityScaleOf('platinum')).toBe('fineness')
    expect(purityScaleOf('stainless_steel')).toBeNull()
    expect(purityScaleOf('tungsten')).toBeNull()
  })

  it('offers the choices of the metal', () => {
    expect(purityChoicesFor('gold')).toEqual(['10', '14', '18', '22', '24'])
    expect(purityChoicesFor('silver')[0]).toBe('925')
    expect(purityChoicesFor('platinum')[0]).toBe('950')
    expect(purityChoicesFor('titanium')).toEqual([])
  })

  it('starts silver on 925, platinum and palladium on 950, gold on nothing', () => {
    expect(defaultPurityFor('silver')).toBe('925')
    expect(defaultPurityFor('platinum')).toBe('950')
    expect(defaultPurityFor('palladium')).toBe('950')
    expect(defaultPurityFor('gold')).toBe('')
  })

  it('refuses a purity the metal cannot have', () => {
    expect(isValidPurity('gold', '28')).toBe(false)
    expect(isValidPurity('gold', '0')).toBe(false)
    expect(isValidPurity('gold', '925')).toBe(false)
    expect(isValidPurity('silver', '14')).toBe(false)
    expect(isValidPurity('silver', '1000')).toBe(false)
    expect(isValidPurity('stainless_steel', '14')).toBe(false)
    expect(isValidPurity('gold', '14K')).toBe(false)
    expect(isValidPurity('gold', '14.25')).toBe(false)
  })

  it('takes one it can', () => {
    expect(isValidPurity('gold', '14')).toBe(true)
    expect(isValidPurity('gold', '9')).toBe(true)
    expect(isValidPurity('gold', '14.5')).toBe(true)
    expect(isValidPurity('rose_gold', 18)).toBe(true)
    expect(isValidPurity('silver', '925')).toBe(true)
    expect(isValidPurity('silver', '999.9')).toBe(true)
    expect(isValidPurity('platinum', 950)).toBe(true)
    expect(isValidPurity('gold', 1.1)).toBe(true)
    // Not known is allowed, whatever the metal.
    expect(isValidPurity('gold', '')).toBe(true)
    expect(isValidPurity('stainless_steel', null)).toBe(true)
  })

  it('reads as 14K for gold and 925 for silver', () => {
    expect(purityText('gold', 14)).toBe('14K')
    expect(purityText('gold', '14.0')).toBe('14K')
    expect(purityText('silver', 925)).toBe('925')
    expect(purityText('platinum', '950.0')).toBe('950')
    expect(purityText(null, 10)).toBe('10K')
    expect(purityText('gold', '')).toBe('')
    expect(purityText('gold', 0)).toBe('')
  })

  it('turns what was heard or read into what the popup keeps', () => {
    expect(purityFromWords('gold', '14K')).toBe('14')
    expect(purityFromWords('gold', '14 kt')).toBe('14')
    expect(purityFromWords('silver', 925)).toBe('925')
    expect(purityFromWords('silver', '14K')).toBe('')
    expect(purityFromWords('gold', 585)).toBe('')
    expect(purityFromWords('gold', 'sterling')).toBe('')
    expect(purityFromWords(null, null)).toBe('')
  })
})

describe('pricing by purity', () => {
  it('prices fine silver as fine, the rest as sterling', () => {
    expect(purityFromItem({ metal: 'silver', karat: '999' })).toBe('fine')
    expect(purityFromItem({ metal: 'silver', karat: '925' })).toBe('sterling_925')
    expect(purityFromItem({ metal: 'silver', karat: null })).toBe('sterling_925')
  })

  it('pays for the metal that is there', () => {
    expect(purityContentRatio('gold', '12', '14k')).toBeCloseTo(12 / 14)
    expect(purityContentRatio('gold', '24', 'pure_24k')).toBe(1)
    expect(purityContentRatio('silver', '800', 'sterling_925')).toBeCloseTo(800 / 925)
    expect(purityContentRatio('silver', '925', 'sterling_925')).toBe(1)
    expect(purityContentRatio('platinum', '900', 'platinum_950')).toBeCloseTo(900 / 950)
    // Unknown or impossible: priced as its bucket, never more.
    expect(purityContentRatio('silver', '', 'sterling_925')).toBe(1)
    expect(purityContentRatio('silver', '14', 'sterling_925')).toBe(1)
  })
})
