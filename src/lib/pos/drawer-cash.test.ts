import { describe, expect, it } from 'vitest'
import {
  drawerCashNet,
  emptyDrawerCash,
  expectedDrawerCash,
  summarizeDrawerCash,
  type DrawerCashInput,
} from './drawer-cash'

const none: DrawerCashInput = {
  salePayments: [],
  cashReturns: [],
  layawayRefunds: [],
  voidedSales: [],
  loanPayments: [],
  loansWritten: [],
  loansVoided: [],
  repairPayments: [],
  buyPayouts: [],
  consignmentPayouts: [],
}

describe('summarizeDrawerCash', () => {
  it('a pawn day: one $500 loan out, two $30 interest payments in', () => {
    const l = summarizeDrawerCash({
      ...none,
      loansWritten: [{ principal: '500.0000' }],
      loanPayments: [{ amount: 30 }, { amount: '30.0000' }],
    })
    expect(l.pawnLoans).toBe(500)
    expect(l.pawnPayments).toBe(60)
    expect(drawerCashNet(l)).toBe(-440)
    expect(expectedDrawerCash(1000, l)).toBe(560)
  })

  it('a voided pawn payment nets out (its reversal row is negative)', () => {
    const l = summarizeDrawerCash({ ...none, loanPayments: [{ amount: 30 }, { amount: -30 }, { amount: 45 }] })
    expect(l.pawnPayments).toBe(45)
  })

  it('a loan written and voided the same day nets to zero', () => {
    const l = summarizeDrawerCash({ ...none, loansWritten: [{ principal: 65.39 }], loansVoided: [{ principal: 65.39 }] })
    expect(drawerCashNet(l)).toBe(0)
  })

  it('counts a layaway payment once (sale_payments) and its cancellation refund as out', () => {
    // A $100 layaway payment is a sale_payments row; the refund on
    // cancellation is a negative layaway_payments row only.
    const l = summarizeDrawerCash({ ...none, salePayments: [{ amount: 100 }], layawayRefunds: [{ amount: -90 }] })
    expect(l.posSales).toBe(100)
    expect(l.posRefunds).toBe(90)
    expect(drawerCashNet(l)).toBe(10)
  })

  it('a voided sale gives back its cash, less what a cash return already gave back', () => {
    const l = summarizeDrawerCash({
      ...none,
      voidedSales: [
        {
          sale_payments: [
            { amount: 80, payment_method: 'cash', deleted_at: null },
            { amount: 50, payment_method: 'card', deleted_at: null },
            { amount: 20, payment_method: 'cash', deleted_at: '2026-11-24T10:00:00Z' },
          ],
          returns: [{ total: 30, refund_method: 'cash', deleted_at: null }],
        },
      ],
    })
    expect(l.posRefunds).toBe(50)
  })

  it('every other line, in and out', () => {
    const l = summarizeDrawerCash({
      ...none,
      salePayments: [{ amount: 200 }],
      cashReturns: [{ total: 25 }],
      repairPayments: [{ amount: 40 }, { amount: null }],
      buyPayouts: [{ amount: 300 }],
      consignmentPayouts: [{ amount: 75 }],
    })
    expect(l).toMatchObject({ posSales: 200, posRefunds: 25, repairPayments: 40, buys: 300, consignment: 75 })
    expect(drawerCashNet(l)).toBe(200 - 25 + 40 - 300 - 75)
  })

  it('an empty drawer is its opening count', () => {
    expect(expectedDrawerCash('150.00', emptyDrawerCash())).toBe(150)
  })
})
