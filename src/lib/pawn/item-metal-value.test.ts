import { describe, expect, it } from 'vitest'
import type { RateMaps } from '@/lib/metal-counter/math'
import {
  estValueAfterChange,
  itemMetalValue,
  metalValueText,
} from './item-metal-value'

// Round numbers so the arithmetic is readable: pure gold $100/g.
const rates: RateMaps = {
  spot: {
    'gold::pure_24k': 100,
    'gold::22k': 91.6667,
    'gold::18k': 75,
    'gold::14k': 58.3333,
    'gold::10k': 41.6667,
    'silver::sterling_925': 1,
    'platinum::platinum_950': 30,
  },
  pay: { 'gold::18k': 0.6, 'silver::sterling_925': 0.5 },
  sell: {},
}
const solid = { coating: 'none' }
const ok = (v: ReturnType<typeof itemMetalValue>) => {
  if (v.status !== 'ok') throw new Error('expected ok, got ' + v.status)
  return v
}

describe('itemMetalValue', () => {
  it('is weight × spot at the karat when the shop set no percent', () => {
    const v = ok(itemMetalValue(rates, { metal: 'gold', karat: '14', weightGrams: '5', ...solid }))
    expect(v.percent).toBe(100)
    expect(v.perGram).toBe(58.3333)
    expect(v.value).toBe(291.67)
  })

  it("applies the shop's pay percent for that karat", () => {
    const v = ok(itemMetalValue(rates, { metal: 'gold', karat: '18', weightGrams: '10', ...solid }))
    expect(v.percent).toBe(60)
    expect(v.perGram).toBe(45)
    expect(v.value).toBe(450)
  })

  it('prices rose and white gold as gold', () => {
    const rose = ok(itemMetalValue(rates, { metal: 'rose_gold', karat: 14, weightGrams: 5, ...solid }))
    const white = ok(itemMetalValue(rates, { metal: 'white_gold', karat: 14, weightGrams: 5, ...solid }))
    expect(rose.value).toBe(291.67)
    expect(white.value).toBe(291.67)
  })

  it('prices a karat between buckets by its gold content, not the bucket above', () => {
    // 12K falls in the 14K bucket: 12/14 of the 14K price = half of pure.
    const v12 = ok(itemMetalValue(rates, { metal: 'gold', karat: '12', weightGrams: '10', ...solid }))
    expect(v12.perGram).toBeCloseTo(50, 3)
    expect(v12.value).toBeCloseTo(500, 1)
    // 9K falls in the 10K bucket: 9/10 of the 10K price.
    const v9 = ok(itemMetalValue(rates, { metal: 'gold', karat: '9', weightGrams: '10', ...solid }))
    expect(v9.perGram).toBeCloseTo(37.5, 3)
    // 16K and 21K keep the pay percent of the bucket they fall in.
    const v16 = ok(itemMetalValue(rates, { metal: 'gold', karat: '16', weightGrams: '10', ...solid }))
    expect(v16.percent).toBe(60)
    expect(v16.perGram).toBeCloseTo(75 * 0.6 * (16 / 18), 3)
    const v21 = ok(itemMetalValue(rates, { metal: 'gold', karat: '21', weightGrams: '1', ...solid }))
    expect(v21.perGram).toBeCloseTo(91.6667 * (21 / 22), 3)
  })

  it('prices 24K as the top bucket', () => {
    const v = ok(itemMetalValue(rates, { metal: 'gold', karat: '24', weightGrams: '2', ...solid }))
    expect(v.value).toBe(200)
    expect(ok(itemMetalValue(rates, { metal: 'gold', karat: '23.6', weightGrams: '2', ...solid })).value).toBe(200)
  })

  it('needs no karat for silver and platinum', () => {
    const silver = ok(itemMetalValue(rates, { metal: 'silver', karat: '', weightGrams: '100', ...solid }))
    expect(silver.percent).toBe(50)
    expect(silver.value).toBe(50)
    expect(ok(itemMetalValue(rates, { metal: 'platinum', karat: null, weightGrams: '3', ...solid })).value).toBe(90)
  })

  it('says what is missing', () => {
    expect(itemMetalValue(rates, { metal: '', karat: '14', weightGrams: '5', ...solid }).status).toBe('incomplete')
    expect(itemMetalValue(rates, { metal: 'gold', karat: '', weightGrams: '5', ...solid }).status).toBe('incomplete')
    expect(itemMetalValue(rates, { metal: 'gold', karat: '14', weightGrams: '', ...solid }).status).toBe('incomplete')
    expect(itemMetalValue(rates, { metal: 'gold', karat: '14', weightGrams: '0', ...solid }).status).toBe('incomplete')
    // Below 8K there is no bucket to price from.
    expect(itemMetalValue(rates, { metal: 'gold', karat: '6', weightGrams: '5', ...solid }).status).toBe('incomplete')
  })

  it('gives no value to a metal that is not priced off spot', () => {
    for (const metal of ['stainless_steel', 'tungsten', 'titanium', 'mixed', 'none', 'other']) {
      expect(itemMetalValue(rates, { metal, karat: '14', weightGrams: '5', ...solid }).status).toBe('not_precious')
    }
  })

  it('gives no value to a plated or filled piece', () => {
    for (const coating of ['gold_plated', 'gold_filled', 'vermeil', 'pvd']) {
      expect(itemMetalValue(rates, { metal: 'gold', karat: '14', weightGrams: '5', coating }).status).toBe('coated')
    }
  })

  it('says so when no spot price is loaded', () => {
    expect(itemMetalValue(rates, { metal: 'palladium', karat: '', weightGrams: '5', ...solid }).status).toBe('no_price')
    expect(
      itemMetalValue({ spot: {}, pay: {}, sell: {} }, { metal: 'gold', karat: '14', weightGrams: '5', ...solid }).status,
    ).toBe('no_price')
  })
})

describe('metalValueText', () => {
  it('is the value with two decimals, or empty', () => {
    expect(metalValueText(itemMetalValue(rates, { metal: 'gold', karat: '18', weightGrams: '10', ...solid }))).toBe('450.00')
    expect(metalValueText({ status: 'incomplete' })).toBe('')
    expect(metalValueText({ status: 'coated' })).toBe('')
  })
})

describe('estValueAfterChange', () => {
  it('takes the metal value while the field is still at zero or empty', () => {
    expect(estValueAfterChange('0', '', '291.67')).toBe('291.67')
    expect(estValueAfterChange('', '', '291.67')).toBe('291.67')
  })

  it('keeps following as the weight is typed', () => {
    expect(estValueAfterChange('291.67', '291.67', '303.33')).toBe('303.33')
  })

  it('leaves alone a value the clerk typed', () => {
    expect(estValueAfterChange('400', '291.67', '303.33')).toBe('400')
    expect(estValueAfterChange('400', '', '291.67')).toBe('400')
  })

  it('goes back to zero when the metal value goes away', () => {
    expect(estValueAfterChange('291.67', '291.67', '')).toBe('0')
  })

  it('changes nothing when the metal value did not move', () => {
    expect(estValueAfterChange('0', '291.67', '291.67')).toBe('0')
    expect(estValueAfterChange('400', '', '')).toBe('400')
  })
})
