import { describe, expect, it } from 'vitest'
import {
  computeReturnRefund,
  isReturnableSaleStatus,
  type ReturnLine,
  type ReturnSaleTotals,
} from './returns'

function line(over: Partial<ReturnLine> = {}): ReturnLine {
  return {
    sold_quantity: 1,
    already_returned: 0,
    line_total: 100,
    return_quantity: 1,
    ...over,
  }
}

function sale(over: Partial<ReturnSaleTotals> = {}): ReturnSaleTotals {
  return {
    subtotal: 100,
    discount_amount: 0,
    tax_amount: 0,
    total: 100,
    paid_total: 100,
    returned_total: 0,
    ...over,
  }
}

describe('isReturnableSaleStatus', () => {
  it('only completed and partially returned sales', () => {
    expect(isReturnableSaleStatus('completed')).toBe(true)
    expect(isReturnableSaleStatus('partial_returned')).toBe(true)
    expect(isReturnableSaleStatus('open')).toBe(false)
    expect(isReturnableSaleStatus('voided')).toBe(false)
    expect(isReturnableSaleStatus('fully_returned')).toBe(false)
  })
})

describe('computeReturnRefund — a sale that kept each line\'s own tax (0095)', () => {
  // A $10,000 ring and a $100 chain; 6% state + 1.5% county capped at $5,000
  // per item: the ring carries $675 (6.75%), the chain $7.50 (7.5%).
  const capped = sale({ subtotal: 10100, tax_amount: 682.5, total: 10782.5, paid_total: 10782.5 })
  const ring = (over: Partial<ReturnLine> = {}) => line({ line_total: 10000, line_tax: 675, ...over })
  const chain = (over: Partial<ReturnLine> = {}) => line({ line_total: 100, line_tax: 7.5, ...over })

  it('refunds the tax that line was charged, not an average', () => {
    const r = computeReturnRefund({ sale: capped, lines: [ring({ return_quantity: 0 }), chain()] })
    // The average rate would give back $6.76.
    expect(r.tax).toBe(7.5)
    expect(r.total).toBe(107.5)
  })

  it('returning the capped item gives back its own tax', () => {
    const r = computeReturnRefund({ sale: capped, lines: [ring(), chain({ return_quantity: 0 })] })
    expect(r.tax).toBe(675)
    expect(r.total).toBe(10675)
  })

  it('part of a line gets that part of its tax', () => {
    const two = sale({ subtotal: 12000, tax_amount: 870, total: 12870, paid_total: 12870 })
    const r = computeReturnRefund({
      sale: two,
      lines: [line({ sold_quantity: 2, line_total: 12000, line_tax: 870, return_quantity: 1 })],
    })
    expect(r.tax).toBe(435)
    expect(r.total).toBe(6435)
  })

  it('falls back to the proportional share when any line has no tax of its own', () => {
    const r = computeReturnRefund({
      sale: capped,
      lines: [ring({ return_quantity: 0, line_tax: null }), chain()],
    })
    expect(r.tax).toBe(6.7574)
  })
})

describe('computeReturnRefund', () => {
  it('plain sale, no discount, no tax', () => {
    const r = computeReturnRefund({ sale: sale(), lines: [line()] })
    expect(r.total).toBe(100)
    expect(r.subtotal).toBe(100)
    expect(r.tax).toBe(0)
    expect(r.isFinal).toBe(true)
  })

  it('refunds the tax the customer paid', () => {
    // $100 item at 7%: paid $107, gets $107 back (was $100).
    const r = computeReturnRefund({
      sale: sale({ tax_amount: 7, total: 107, paid_total: 107 }),
      lines: [line()],
    })
    expect(r.subtotal).toBe(100)
    expect(r.tax).toBe(7)
    expect(r.total).toBe(107)
  })

  it('a line discount reduces the refund', () => {
    // $100 item, $30 line discount, 7% tax: paid $74.90, refund $74.90
    // (was $100.00 — a $25.10 over-refund).
    const r = computeReturnRefund({
      sale: sale({ subtotal: 70, tax_amount: 4.9, total: 74.9, paid_total: 74.9 }),
      lines: [line({ line_total: 70 })],
    })
    expect(r.merchandise).toBe(70)
    expect(r.total).toBe(74.9)
  })

  it('a cart discount is shared across lines in proportion', () => {
    // Two $100 items, $20 off the cart, 7% tax on $180 = $12.60 → $192.60.
    const s = sale({
      subtotal: 200,
      discount_amount: 20,
      tax_amount: 12.6,
      total: 192.6,
      paid_total: 192.6,
    })
    const one = computeReturnRefund({
      sale: s,
      lines: [line(), line({ return_quantity: 0 })],
    })
    expect(one.merchandise).toBe(100)
    expect(one.discount).toBe(10)
    expect(one.subtotal).toBe(90)
    expect(one.tax).toBe(6.3)
    expect(one.total).toBe(96.3)
    expect(one.isFinal).toBe(false)
    expect(one.lineValues).toEqual([100, 0])
  })

  it('partial quantity of a line', () => {
    // 3 units for $90 total → return 1 = $30.
    const r = computeReturnRefund({
      sale: sale({ subtotal: 90, total: 90, paid_total: 90 }),
      lines: [line({ sold_quantity: 3, line_total: 90, return_quantity: 1 })],
    })
    expect(r.total).toBe(30)
    expect(r.isFinal).toBe(false)
  })

  it('the last return refunds exactly what is left, absorbing rounding', () => {
    // Three $33.33 lines, 7% tax: total 106.9893. Return them one at a time.
    const base = {
      subtotal: 99.99,
      tax_amount: 6.9993,
      total: 106.9893,
      paid_total: 106.99,
    }
    const lines = [33.33, 33.33, 33.33]
    let returned = 0
    const refunds: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = computeReturnRefund({
        sale: sale({ ...base, returned_total: returned }),
        lines: lines.map((lt, idx) =>
          line({
            line_total: lt,
            already_returned: idx < i ? 1 : 0,
            return_quantity: idx === i ? 1 : 0,
          }),
        ),
      })
      refunds.push(r.total)
      returned = Math.round((returned + r.total) * 10000) / 10000
      expect(r.isFinal).toBe(i === 2)
    }
    // The three refunds add up to the sale total to the 4th decimal.
    expect(returned).toBe(106.9893)
    expect(refunds[0]).toBe(35.6631)
  })

  it('never refunds more than was paid', () => {
    // Sale total $100 but only $40 collected (should not happen on a
    // completed sale — the cap is the backstop).
    const r = computeReturnRefund({
      sale: sale({ paid_total: 40 }),
      lines: [line()],
    })
    expect(r.total).toBe(40)
    expect(r.capped).toBe(true)
  })

  it('an unpaid sale refunds nothing', () => {
    const r = computeReturnRefund({
      sale: sale({ paid_total: 0 }),
      lines: [line()],
    })
    expect(r.total).toBe(0)
  })

  it('never refunds more than what has not already been refunded', () => {
    const r = computeReturnRefund({
      sale: sale({ returned_total: 100 }),
      lines: [line()],
    })
    expect(r.total).toBe(0)
  })

  it('clamps a quantity above what remains', () => {
    const r = computeReturnRefund({
      sale: sale({ subtotal: 90, total: 90, paid_total: 90, returned_total: 30 }),
      lines: [
        line({ sold_quantity: 3, already_returned: 1, line_total: 90, return_quantity: 5 }),
      ],
    })
    expect(r.merchandise).toBe(60)
    expect(r.total).toBe(60)
    expect(r.isFinal).toBe(true)
  })

  it('nothing selected → zero, not final', () => {
    const r = computeReturnRefund({
      sale: sale(),
      lines: [line({ return_quantity: 0 })],
    })
    expect(r.total).toBe(0)
    expect(r.isFinal).toBe(false)
  })

  it('accepts numeric strings from the database', () => {
    const r = computeReturnRefund({
      sale: {
        subtotal: '100.0000',
        discount_amount: '0.0000',
        tax_amount: '7.0000',
        total: '107.0000',
        paid_total: '107.0000',
        returned_total: '0.0000',
      },
      lines: [
        { sold_quantity: '1.0000', already_returned: '0', line_total: '100.0000', return_quantity: 1 },
      ],
    })
    expect(r.total).toBe(107)
  })
})
