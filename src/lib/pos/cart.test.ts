import { describe, expect, it } from 'vitest'
import { computeBalance, computeLineTotal, computeSubtotal, computeTotal, r2 } from './cart'

describe('r2', () => {
  it('rounds half away from zero, like Postgres', () => {
    expect(r2(21.3144)).toBe(21.31)
    expect(r2(1.005)).toBe(1.01)
    expect(r2(2.675)).toBe(2.68)
    expect(r2(-1.005)).toBe(-1.01)
    expect(r2(Number.NaN)).toBe(0)
  })
})

describe('cart totals in cents (REVIEW finding 16)', () => {
  it('$19.92 at 7% is $21.31 — the value sale_create() stores', () => {
    const t = computeTotal({ subtotal: 19.92, discount: 0, tax_rate: 0.07 })
    expect(t.tax).toBe(1.39)
    expect(t.total).toBe(21.31)
  })
  it('rounds each line and floors it at zero', () => {
    expect(computeLineTotal({ quantity: 3, unit_price: 0.333, line_discount: 0 })).toBe(0.99)
    expect(computeLineTotal({ quantity: 1, unit_price: 5, line_discount: 9 })).toBe(0)
    expect(computeSubtotal([
      { quantity: 1, unit_price: 10.005, line_discount: 0 },
      { quantity: 1, unit_price: 0.1, line_discount: 0 },
    ])).toBe(10.11)
  })
  it('applies the cart discount before tax', () => {
    const t = computeTotal({ subtotal: 100, discount: 10.004, tax_rate: 0.075 })
    expect(t.discount).toBe(10)
    expect(t.tax).toBe(6.75)
    expect(t.total).toBe(96.75)
  })
})

describe('computeBalance', () => {
  it('lets an older 4-decimal total be paid in cents', () => {
    expect(computeBalance({ total: '21.3144', paid_total: '21.31' })).toBe(0)
    expect(computeBalance({ total: 50, paid_total: 20.5 })).toBe(29.5)
    expect(computeBalance({ total: 10, paid_total: 12 })).toBe(0)
  })
})
