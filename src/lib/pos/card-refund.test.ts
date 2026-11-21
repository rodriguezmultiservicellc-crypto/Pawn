import { describe, expect, it } from 'vitest'
import { planCardRefund, totalRefundable } from './card-refund'

const a = { paymentId: 'p_new', paymentIntentId: 'pi_new', remaining: 30 }
const b = { paymentId: 'p_old', paymentIntentId: 'pi_old', remaining: 20 }

describe('planCardRefund', () => {
  it('takes from the newest charge first', () => {
    expect(planCardRefund([a, b], 25)).toEqual({
      allocations: [{ paymentId: 'p_new', paymentIntentId: 'pi_new', amount: 25 }],
      short: 0,
    })
  })
  it('spills onto the next charge', () => {
    expect(planCardRefund([a, b], 45)).toEqual({
      allocations: [
        { paymentId: 'p_new', paymentIntentId: 'pi_new', amount: 30 },
        { paymentId: 'p_old', paymentIntentId: 'pi_old', amount: 15 },
      ],
      short: 0,
    })
  })
  it('reports what Stripe cannot cover', () => {
    expect(planCardRefund([a, b], 60).short).toBe(10)
    expect(planCardRefund([], 5)).toEqual({ allocations: [], short: 5 })
  })
  it('skips charges already fully refunded and works in cents', () => {
    expect(planCardRefund([{ ...a, remaining: 0 }, b], 10.1).allocations).toEqual([
      { paymentId: 'p_old', paymentIntentId: 'pi_old', amount: 10.1 },
    ])
    expect(planCardRefund([{ ...a, remaining: 0.3 }], 0.1 + 0.2).short).toBe(0)
  })
})

describe('totalRefundable', () => {
  it('sums what is left, never negative', () => {
    expect(totalRefundable([a, b, { ...b, remaining: -1 }])).toBe(50)
  })
})
