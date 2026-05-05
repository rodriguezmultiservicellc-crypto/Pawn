// src/lib/loyalty/math.test.ts
import { describe, expect, it } from 'vitest'
import {
  computeRetailEarn,
  computeLoanInterestEarn,
  computeRedemptionDiscount,
  generateReferralCode,
  canApplyAdjustment,
  isValidReferralCode,
  clampClawback,
} from './math'

describe('computeRetailEarn', () => {
  it('computes integer-floored points on a normal sale', () => {
    expect(computeRetailEarn(100, 1)).toBe(100)
  })

  it('floors fractional points', () => {
    // $5.70 sale × 1 pt/$1 = 5.7 → 5
    expect(computeRetailEarn(5.7, 1)).toBe(5)
  })

  it('returns 0 on a $0 sale', () => {
    expect(computeRetailEarn(0, 1)).toBe(0)
  })

  it('returns 0 on a negative subtotal (defensive)', () => {
    expect(computeRetailEarn(-10, 1)).toBe(0)
  })

  it('handles non-integer rates', () => {
    // $20 × 1.5 pts/$1 = 30 pts
    expect(computeRetailEarn(20, 1.5)).toBe(30)
  })
})

describe('computeLoanInterestEarn', () => {
  it('computes integer-floored points on interest paid', () => {
    expect(computeLoanInterestEarn(50, 1)).toBe(50)
  })

  it('returns 0 on $0 interest', () => {
    expect(computeLoanInterestEarn(0, 1)).toBe(0)
  })

  it('floors fractional points', () => {
    expect(computeLoanInterestEarn(12.99, 1)).toBe(12)
  })
})

describe('computeRedemptionDiscount', () => {
  it('converts at the standard 100 pts = $1 rate', () => {
    expect(
      computeRedemptionDiscount({
        points: 1000,
        rate: 100,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 10, pointsConsumed: 1000 })
  })

  it('caps discount at sale.subtotal − alreadyDiscounted', () => {
    // $30 sale, $5 already discounted, asks for $50 in discount → caps at $25
    // ($25 × 100 pts/$1 = 2500 pts consumed, NOT the full 5000 requested)
    expect(
      computeRedemptionDiscount({
        points: 5000,
        rate: 100,
        saleSubtotal: 30,
        alreadyDiscounted: 5,
      }),
    ).toEqual({ discount: 25, pointsConsumed: 2500 })
  })

  it('returns 0 discount + 0 consumed on 0 points', () => {
    expect(
      computeRedemptionDiscount({
        points: 0,
        rate: 100,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 0, pointsConsumed: 0 })
  })

  it('handles a high redemption rate (1 pt = $1)', () => {
    expect(
      computeRedemptionDiscount({
        points: 5,
        rate: 1,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 5, pointsConsumed: 5 })
  })

  it('rounds fractional discount to 2dp', () => {
    // 33 pts / 100 = $0.33
    expect(
      computeRedemptionDiscount({
        points: 33,
        rate: 100,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 0.33, pointsConsumed: 33 })
  })

  it('returns 0 + 0 when points is NaN', () => {
    expect(
      computeRedemptionDiscount({
        points: NaN,
        rate: 100,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 0, pointsConsumed: 0 })
  })

  it('returns 0 + 0 when rate is Infinity', () => {
    expect(
      computeRedemptionDiscount({
        points: 100,
        rate: Infinity,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 0, pointsConsumed: 0 })
  })

  it('floors fractional points in the un-capped branch', () => {
    // 33.7 floors to 33; 33/100 = 0.33
    expect(
      computeRedemptionDiscount({
        points: 33.7,
        rate: 100,
        saleSubtotal: 50,
        alreadyDiscounted: 0,
      }),
    ).toEqual({ discount: 0.33, pointsConsumed: 33 })
  })
})

describe('generateReferralCode', () => {
  it('produces a 6-char code', () => {
    const code = generateReferralCode(Math.random)
    expect(code).toHaveLength(6)
  })

  it('only contains A-Z + digits 2-9 (no I/O/0/1)', () => {
    // Generate 200 codes, every char must be in the safe alphabet.
    const safe = /^[A-HJ-NP-Z2-9]{6}$/
    for (let i = 0; i < 200; i++) {
      expect(generateReferralCode(Math.random)).toMatch(safe)
    }
  })

  it('is deterministic given a seeded RNG', () => {
    // Sequential rng returning 0, 0.1, etc. — both calls produce same string.
    const makeSeed = () => {
      let i = 0
      const seq = [0, 0.1, 0.2, 0.3, 0.4, 0.5]
      return () => seq[i++ % seq.length]!
    }
    expect(generateReferralCode(makeSeed())).toBe(generateReferralCode(makeSeed()))
  })
})

describe('canApplyAdjustment', () => {
  it('blocks delta that would take balance below zero', () => {
    expect(canApplyAdjustment(50, -100)).toBe(false)
  })

  it('allows delta that exactly hits zero', () => {
    expect(canApplyAdjustment(50, -50)).toBe(true)
  })

  it('always allows positive delta', () => {
    expect(canApplyAdjustment(0, 100)).toBe(true)
  })
})

describe('isValidReferralCode', () => {
  it('accepts 6 chars from the safe alphabet', () => {
    expect(isValidReferralCode('XF4P9Q')).toBe(true)
  })

  it('rejects lowercase', () => {
    expect(isValidReferralCode('xf4p9q')).toBe(false)
  })

  it('rejects banned chars (I, O, 0, 1)', () => {
    expect(isValidReferralCode('AIOQ23')).toBe(false)
    expect(isValidReferralCode('ABC012')).toBe(false)
  })

  it('rejects wrong length', () => {
    expect(isValidReferralCode('ABCDE')).toBe(false)
    expect(isValidReferralCode('ABCDEFG')).toBe(false)
  })
})

describe('clampClawback', () => {
  it('returns the requested clawback when balance covers it', () => {
    expect(clampClawback({ pointsToClaw: 100, currentBalance: 500 })).toBe(100)
  })

  it('caps at current balance when not covered', () => {
    expect(clampClawback({ pointsToClaw: 500, currentBalance: 100 })).toBe(100)
  })

  it('returns 0 when balance is 0', () => {
    expect(clampClawback({ pointsToClaw: 500, currentBalance: 0 })).toBe(0)
  })

  it('treats negative balance as 0 (defensive)', () => {
    expect(clampClawback({ pointsToClaw: 100, currentBalance: -10 })).toBe(0)
  })

  it('treats negative pointsToClaw as 0 (defensive)', () => {
    expect(clampClawback({ pointsToClaw: -50, currentBalance: 200 })).toBe(0)
  })
})
