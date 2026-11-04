import { describe, expect, it } from 'vitest'
import { convertRingSize, nearestUsQuarter } from './ring-size'
import { convertWeight, fromGrams, toGrams } from './weight'
import { alloyDown, fineGold, mixLots, raiseKarat } from './alloy'

describe('ring size', () => {
  it('US 7 is the 17.3 mm reference ring', () => {
    const r = convertRingSize('us', 7)!
    expect(r.diameterMm).toBe(17.32)
    expect(r.eu).toBe(54.4)
    expect(r.us).toBe(7)
  })
  it('EU 54 → US ≈ 6.84 and back', () => {
    const r = convertRingSize('eu', 54)!
    expect(r.diameterMm).toBe(17.19)
    expect(r.us).toBe(6.84)
    expect(convertRingSize('us', r.us)!.eu).toBe(54)
  })
  it('Japan size 1 is 13.0 mm, size 13 is 17.0 mm', () => {
    expect(convertRingSize('jp', 1)!.diameterMm).toBe(13)
    expect(convertRingSize('jp', 13)!.diameterMm).toBe(17)
    expect(convertRingSize('mm', 17)!.jp).toBe(13)
  })
  it('mm is the identity scale', () => {
    const r = convertRingSize('mm', 18.5)!
    expect(r.diameterMm).toBe(18.5)
    expect(r.circumferenceMm).toBe(58.1)
  })
  it('rejects junk and typos', () => {
    expect(convertRingSize('us', NaN)).toBeNull()
    expect(convertRingSize('mm', 3)).toBeNull()
    expect(convertRingSize('us', 40)).toBeNull()
  })
  it('snaps to the mandrel quarter', () => {
    expect(nearestUsQuarter(6.83)).toBe(6.75)
    expect(nearestUsQuarter(7.13)).toBe(7.25)
  })
})

describe('weight units', () => {
  it('troy ounce and pennyweight are exact', () => {
    expect(toGrams(1, 'ozt')).toBe(31.1035)
    expect(toGrams(20, 'dwt')).toBe(31.1035)
    expect(fromGrams(31.1034768, 'dwt')).toBe(20)
  })
  it('avoirdupois ounce differs from troy', () => {
    expect(toGrams(1, 'oz')).toBe(28.3495)
  })
  it('converts one value to every unit', () => {
    expect(convertWeight(10, 'g')).toEqual({ g: 10, dwt: 6.4301, ozt: 0.3215, oz: 0.3527 })
    expect(convertWeight(-1, 'g')).toBeNull()
  })
})

describe('alloy math', () => {
  it('alloy down 18k → 14k: 10 g needs 2.8571 g of alloy', () => {
    expect(alloyDown(10, 18, 14)).toEqual({ fineGoldG: 7.5, alloyToAddG: 2.8571, newTotalG: 12.8571 })
  })
  it('alloy down refuses going up or sideways', () => {
    expect(alloyDown(10, 14, 18)).toBeNull()
    expect(alloyDown(10, 14, 14)).toBeNull()
  })
  it('raise 10k → 14k: 10 g needs 4 g of pure gold', () => {
    expect(raiseKarat(10, 10, 14)).toEqual({ fineGoldG: 4.1667, pureGoldToAddG: 4, newTotalG: 14 })
    // Check: (10·10/24 + 4) / 14 = 8.1667/14 = 0.5833 = 14/24 ✓
  })
  it('raise refuses 24k and going down', () => {
    expect(raiseKarat(10, 14, 24)).toBeNull()
    expect(raiseKarat(10, 18, 14)).toBeNull()
  })
  it('mix lots: 10 g 14k + 5 g 18k = 15 g at 15.33k', () => {
    const r = mixLots([
      { weightG: 10, karat: 14 },
      { weightG: 5, karat: 18 },
      { weightG: 0, karat: 22 },
    ])
    expect(r).toEqual({ totalG: 15, fineGoldG: 9.5833, karat: 15.33, fineness: 0.6388 })
  })
  it('mix lots with nothing usable is null', () => {
    expect(mixLots([{ weightG: 0, karat: 14 }])).toBeNull()
  })
  it('fine gold', () => {
    expect(fineGold(31.1034768, 14)).toBe(18.1437)
    expect(fineGold(0, 14)).toBeNull()
  })
})
