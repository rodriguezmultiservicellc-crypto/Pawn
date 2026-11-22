import { describe, expect, it } from 'vitest'
import { readerTipsSchema, tipOf } from './reader'
import { tipsByEmployee } from '@/lib/reports/tips'

describe('tipOf — the tip Stripe reports on a card-present charge', () => {
  it('reads cents as dollars', () => {
    expect(tipOf({ amount_details: { tip: { amount: 1500 } } })).toBe(15)
    expect(tipOf({ amount_details: { tip: { amount: 1 } } })).toBe(0.01)
  })
  it('is zero when the reader did not ask, or the customer chose none', () => {
    expect(tipOf({})).toBe(0)
    expect(tipOf({ amount_details: null })).toBe(0)
    expect(tipOf({ amount_details: { tip: null } })).toBe(0)
    expect(tipOf({ amount_details: { tip: { amount: null } } })).toBe(0)
    expect(tipOf({ amount_details: { tip: { amount: 0 } } })).toBe(0)
  })
  it('never returns a negative or broken amount', () => {
    expect(tipOf({ amount_details: { tip: { amount: -500 } } })).toBe(0)
    expect(tipOf({ amount_details: { tip: { amount: Number.NaN } } })).toBe(0)
  })
})

describe('readerTipsSchema', () => {
  it('takes one to three whole percents, in order', () => {
    expect(readerTipsSchema.parse({ enabled: true, percentages: ['15', '20', '25'] })).toEqual({
      enabled: true,
      percentages: [15, 20, 25],
    })
    expect(readerTipsSchema.parse({ enabled: false, percentages: ['18'] }).percentages).toEqual([18])
  })
  it('refuses none, more than three, zero, over 100 and fractions', () => {
    for (const percentages of [[], ['10', '15', '20', '25'], ['0'], ['101'], ['12.5']]) {
      expect(readerTipsSchema.safeParse({ enabled: true, percentages }).success).toBe(false)
    }
  })
})

describe('tipsByEmployee', () => {
  it('totals each employee, largest first, without float drift', () => {
    const rows = [
      { employee_id: 'ana', tip: 0.1 },
      { employee_id: 'ana', tip: 0.2 },
      { employee_id: 'luis', tip: 12 },
      { employee_id: null, tip: 3 },
    ]
    expect(tipsByEmployee(rows)).toEqual([
      { employee_id: 'luis', count: 1, total: 12 },
      { employee_id: null, count: 1, total: 3 },
      { employee_id: 'ana', count: 2, total: 0.3 },
    ])
  })
  it('is empty with no tips', () => {
    expect(tipsByEmployee([])).toEqual([])
  })
})
