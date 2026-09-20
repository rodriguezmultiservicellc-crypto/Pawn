import { describe, expect, it } from 'vitest'
import {
  maxRedeemable,
  r2,
  r4,
  toMoney,
  validateRedemption,
} from './math'

describe('rounding', () => {
  it('lands money on the numeric(18,4) grid', () => {
    expect(r4(12.34567)).toBe(12.3457)
    expect(r4(0.1 + 0.2)).toBe(0.3)
  })

  it('rounds display amounts to cents', () => {
    expect(r2(12.3456)).toBe(12.35)
    expect(r2(1.005)).toBe(1.01)
  })

  it('coerces Supabase numerics and rejects junk', () => {
    expect(toMoney('42.5000')).toBe(42.5)
    expect(toMoney(null)).toBe(0)
    expect(toMoney('not money')).toBe(0)
  })
})

describe('maxRedeemable', () => {
  it('is capped by the balance when credit is the smaller side', () => {
    expect(maxRedeemable({ balance: 25, balanceDue: 100 })).toBe(25)
  })

  it('is capped by what the sale still owes', () => {
    expect(maxRedeemable({ balance: 500, balanceDue: 42.75 })).toBe(42.75)
  })

  it('rounds DOWN to cents so the suggestion never breaches either cap', () => {
    expect(maxRedeemable({ balance: 10.9999, balanceDue: 100 })).toBe(10.99)
  })

  it('offers nothing when the sale is already paid', () => {
    expect(maxRedeemable({ balance: 50, balanceDue: 0 })).toBe(0)
    expect(maxRedeemable({ balance: 50, balanceDue: -5 })).toBe(0)
  })

  it('offers nothing when the customer has no credit', () => {
    expect(maxRedeemable({ balance: 0, balanceDue: 80 })).toBe(0)
  })
})

describe('validateRedemption', () => {
  const base = { balance: 100, balanceDue: 60 }

  it('accepts an amount inside both ceilings', () => {
    expect(validateRedemption({ ...base, amount: 25 })).toEqual({
      ok: true,
      amount: 25,
    })
  })

  it('rejects zero and negative amounts', () => {
    expect(validateRedemption({ ...base, amount: 0 })).toEqual({
      ok: false,
      error: 'invalid_amount',
    })
    expect(validateRedemption({ ...base, amount: -5 })).toEqual({
      ok: false,
      error: 'invalid_amount',
    })
  })

  it('rejects more credit than the customer holds', () => {
    expect(
      validateRedemption({ amount: 150, balance: 100, balanceDue: 500 }),
    ).toEqual({ ok: false, error: 'insufficient_balance' })
  })

  it('rejects more than the sale still owes', () => {
    expect(validateRedemption({ ...base, amount: 75 })).toEqual({
      ok: false,
      error: 'exceeds_balance_due',
    })
  })

  it('lets an exact payoff through despite float drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754; paying a 0.3 balance
    // off exactly must not read as "exceeds".
    const res = validateRedemption({
      amount: 0.1 + 0.2,
      balance: 10,
      balanceDue: 0.3,
    })
    expect(res).toEqual({ ok: true, amount: 0.3 })
  })
})
