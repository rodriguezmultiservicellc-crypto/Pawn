import { describe, expect, it } from 'vitest'
import { planLoanPayment, type ChargeModel } from './math'
import { amountForPrincipal, moveChoices } from './payment-choices'

const FL: ChargeModel = { fullPeriods: 2, periodDays: 30, timezone: 'America/New_York' }
// $1,000 at 25% a 30-day period: $250 a period. Issued Aug 21, due Sep 20.
const loan = {
  principal: 1000,
  monthlyRate: 0.25,
  issueDate: '2026-08-21',
  dueDate: '2026-09-20',
  events: [],
  charge: FL,
}

describe('amountForPrincipal', () => {
  for (const [label, args] of [
    ['one period, then $100 toward the loan', { periods: 1, newDueDate: null }],
    ['two periods, then $300 toward the loan', { periods: 2, newDueDate: null }],
    ['no move: interest owed to date, then $100', { periods: 0, newDueDate: null }],
    ['to a picked date, then $100', { periods: 0, newDueDate: '2026-10-30' }],
  ] as const) {
    it(`${label}: the server's own plan puts exactly that much on the principal`, () => {
      const toPrincipal = label.includes('$300') ? 300 : 100
      const base = { ...loan, today: '2026-09-15', ...args, fees: 5 }
      const amount = amountForPrincipal({ ...base, toPrincipal, startAt: 0 })
      expect(amount).not.toBeNull()
      const plan = planLoanPayment({ ...base, amount: amount! })
      expect(plan.ok).toBe(true)
      if (plan.ok) {
        expect(plan.principal_paid).toBeCloseTo(toPrincipal, 2)
        expect(plan.fees_paid).toBe(5)
      }
    })
  }

  it('is null when no amount works (more than the payoff)', () => {
    expect(
      amountForPrincipal({ ...loan, today: '2026-09-15', periods: 1, newDueDate: null, fees: 0, toPrincipal: 5000, startAt: 250 }),
    ).toBeNull()
  })
})

describe('moveChoices', () => {
  it('opens on the move that brings a late ticket current', () => {
    const { startPeriods, choices } = moveChoices(loan, '2026-11-01', 2000)
    expect(startPeriods).toBe(2)
    expect(choices[0]).toMatchObject({ periods: 1, days: 30, due: '2026-10-20' })
  })
})
