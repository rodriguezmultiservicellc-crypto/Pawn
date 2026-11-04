import { describe, expect, it } from 'vitest'
import {
  dollarsFromGrams,
  grams3,
  gramsFromDollars,
  mixedRemaining,
  money2,
  parseNum,
  resolveRate,
  splitTenders,
  sumDollars,
  sumGrams,
  totalsByPurity,
  type RateMaps,
} from './math'
import {
  karatForPurity,
  meltMetalFromItem,
  purityFromItem,
  spotKey,
} from '@/lib/spot-prices/purity'

const maps: RateMaps = {
  spot: { 'gold::14k': 60, 'gold::18k': 77.1429, 'silver::sterling_925': 1.2 },
  pay: { 'gold::14k': 0.85, 'gold::18k': 0.6 },
  sell: { 'gold::14k': 1.05 },
}

describe('resolveRate', () => {
  it('pay side defaults the multiplier to 1 and is always configured', () => {
    const r = resolveRate(maps, 'silver', 'sterling_925', 'pay')
    expect(r).toEqual({ spotPerGram: 1.2, multiplier: 1, configured: true, perGram: 1.2 })
  })
  it('applies the pay multiplier', () => {
    expect(resolveRate(maps, 'gold', '14k', 'pay').perGram).toBe(51)
    expect(resolveRate(maps, 'gold', '18k', 'pay').perGram).toBe(46.2857)
  })
  it('sell side reports configured=false and sells at spot when no rate is set', () => {
    const r = resolveRate(maps, 'gold', '18k', 'sell')
    expect(r.configured).toBe(false)
    expect(r.multiplier).toBe(1)
    expect(r.perGram).toBe(77.1429)
  })
  it('applies the sell multiplier when set', () => {
    expect(resolveRate(maps, 'gold', '14k', 'sell').perGram).toBe(63)
  })
  it('returns nulls without metal/purity or spot', () => {
    expect(resolveRate(maps, null, null, 'pay').perGram).toBeNull()
    expect(resolveRate(maps, 'platinum', 'platinum_950', 'pay').perGram).toBeNull()
  })
})

describe('two-way conversion', () => {
  it('grams → dollars → grams round-trips to 4 dp', () => {
    const perGram = 51
    const dollars = dollarsFromGrams(5.88, perGram)
    expect(dollars).toBe(299.88)
    expect(gramsFromDollars(dollars, perGram)).toBe(5.88)
  })
  it('"customer wants $300 for this 14K" → grams at the pay rate', () => {
    expect(gramsFromDollars(300, 51)).toBe(5.8824)
  })
  it('refuses a zero / negative rate', () => {
    expect(gramsFromDollars(300, 0)).toBeNull()
    expect(gramsFromDollars(300, -1)).toBeNull()
  })
  it('formats inputs', () => {
    expect(money2(299.875)).toBe('299.88')
    expect(grams3(5.8824)).toBe('5.882')
    expect(grams3(6)).toBe('6')
    expect(parseNum('')).toBeNull()
    expect(parseNum('abc')).toBeNull()
    expect(parseNum('6.5')).toBe(6.5)
  })
})

describe('totalsByPurity', () => {
  it('groups by metal + purity, gold first, highest purity first, skips non-metal', () => {
    const groups = totalsByPurity([
      { metal: 'silver', purity: 'sterling_925', grams: 100, dollars: 120 },
      { metal: 'gold', purity: '14k', grams: 5.5, dollars: 280.5 },
      { metal: 'gold', purity: '18k', grams: 2, dollars: 92.57 },
      { metal: 'gold', purity: '14k', grams: 1.5, dollars: 76.5 },
      { metal: null, purity: null, grams: 10, dollars: 50 },
    ])
    expect(groups.map((g) => `${g.metal}:${g.purity}:${g.count}:${g.grams}:${g.dollars}`)).toEqual([
      'gold:18k:1:2:92.57',
      'gold:14k:2:7:357',
      'silver:sterling_925:1:100:120',
    ])
  })
  it('sums grams and dollars', () => {
    const lines = [
      { grams: 1.1111, dollars: 10.5 },
      { grams: 2.2222, dollars: 20.25 },
      { grams: null, dollars: null },
    ]
    expect(sumGrams(lines)).toBe(3.3333)
    expect(sumDollars(lines)).toBe(30.75)
  })
})

describe('splitTenders', () => {
  it('single method → one tender for the whole total', () => {
    expect(splitTenders({ method: 'transfer', total: 412.5, cash: null, transfer: null })).toEqual({
      ok: true,
      tenders: [{ method: 'transfer', amount: 412.5 }],
    })
  })
  it('mixed needs both parts to add up to the cent', () => {
    expect(splitTenders({ method: 'mixed', total: 500, cash: 200, transfer: 300 })).toEqual({
      ok: true,
      tenders: [
        { method: 'cash', amount: 200 },
        { method: 'transfer', amount: 300 },
      ],
    })
    expect(splitTenders({ method: 'mixed', total: 500, cash: 200, transfer: 299.99 })).toEqual({
      ok: false,
      error: 'mixed_amounts_mismatch',
    })
    expect(splitTenders({ method: 'mixed', total: 500, cash: null, transfer: null })).toEqual({
      ok: false,
      error: 'mixed_amounts_required',
    })
  })
  it('drops a zero part so sale_payments.amount > 0 holds', () => {
    expect(splitTenders({ method: 'mixed', total: 500, cash: 500, transfer: 0 })).toEqual({
      ok: true,
      tenders: [{ method: 'cash', amount: 500 }],
    })
  })
  it('refuses a non-positive total', () => {
    expect(splitTenders({ method: 'cash', total: 0, cash: null, transfer: null })).toEqual({
      ok: false,
      error: 'total_not_positive',
    })
  })
  it('mixedRemaining tracks the unallocated part', () => {
    expect(mixedRemaining(500, 200, null)).toBe(300)
    expect(mixedRemaining(500, 200, 300)).toBe(0)
  })
})

describe('purity helpers', () => {
  it('maps the gold family to gold and non-precious to null', () => {
    expect(meltMetalFromItem('rose_gold')).toBe('gold')
    expect(meltMetalFromItem('white_gold')).toBe('gold')
    expect(meltMetalFromItem('platinum')).toBe('platinum')
    expect(meltMetalFromItem('tungsten')).toBeNull()
    expect(meltMetalFromItem(null)).toBeNull()
  })
  it('buckets karats', () => {
    expect(purityFromItem({ metal: 'gold', karat: '14' })).toBe('14k')
    expect(purityFromItem({ metal: 'gold', karat: 16 })).toBe('18k')
    expect(purityFromItem({ metal: 'gold', karat: '24' })).toBe('pure_24k')
    expect(purityFromItem({ metal: 'gold', karat: '7' })).toBeNull()
    expect(purityFromItem({ metal: 'gold', karat: null })).toBeNull()
    expect(purityFromItem({ metal: 'silver', karat: null })).toBe('sterling_925')
    expect(purityFromItem({ metal: 'palladium', karat: null })).toBe('palladium_950')
    expect(purityFromItem({ metal: 'mixed', karat: '14' })).toBeNull()
  })
  it('karat labels and keys', () => {
    expect(karatForPurity('14k')).toBe('14')
    expect(karatForPurity('fine')).toBe('24')
    expect(karatForPurity('sterling_925')).toBeNull()
    expect(spotKey('gold', '14k')).toBe('gold::14k')
  })
})
