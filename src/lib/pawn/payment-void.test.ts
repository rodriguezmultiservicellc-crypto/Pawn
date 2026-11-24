/**
 * Voiding one payment on a pawn ticket: what it undoes and when it is
 * refused. The fixture is ticket 15551 as it stood on 2026-11-23 — payments
 * from the old system, then an $80.00 payment that moved the due date and a
 * $101.00 payoff, both taken in Pawn.
 */

import { describe, expect, it } from 'vitest'
import { planPaymentVoid, voidablePaymentId, type VoidEvent } from './payment-void'
import { liveEvents, payoffBalance, type ChargeModel } from './math'

const ev = (over: Partial<VoidEvent>): VoidEvent => ({
  id: 'e',
  event_type: 'payment',
  occurred_at: '2026-11-24T03:13:29.000Z',
  amount: 0,
  principal_paid: 0,
  interest_paid: 0,
  fees_paid: 0,
  interest_waived: 0,
  payment_method: 'cash',
  new_due_date: null,
  previous_due_date: null,
  reverses_event_id: null,
  legacy_ref: null,
  stripe_session_id: null,
  ...over,
})

const old = [
  ev({ id: 'issued', event_type: 'issued', amount: 100, payment_method: null, occurred_at: '2025-09-24T15:00:00.000Z', legacy_ref: 'xpawn:ticket:1:issued' }),
  ev({ id: 'old-pay', amount: 10, interest_paid: '10.0000', occurred_at: '2026-03-02T17:58:44.000Z', legacy_ref: 'xpawn:pay:1' }),
  ev({ id: 'old-ext', event_type: 'extension', amount: null, payment_method: null, new_due_date: '2026-04-24', occurred_at: '2026-03-02T17:58:45.000Z', legacy_ref: 'xpawn:pay:1:ext' }),
]
const pay80 = ev({ id: 'pay80', amount: 80, interest_paid: 80, occurred_at: '2026-11-24T03:13:29.698Z' })
const ext80 = ev({ id: 'ext80', event_type: 'extension', amount: null, payment_method: null, new_due_date: '2026-12-20', occurred_at: '2026-11-24T03:13:29.805Z' })
const pay101 = ev({ id: 'pay101', amount: 101, principal_paid: 100, interest_paid: 1, occurred_at: '2026-11-24T03:22:04.688Z' })
const red101 = ev({ id: 'red101', event_type: 'redemption', amount: null, payment_method: null, occurred_at: '2026-11-24T03:22:04.779Z' })

const redeemed = { status: 'redeemed' as const, due_date: '2026-12-20', issue_date: '2025-09-24', term_days: 30 }
const all = [...old, pay80, ext80, pay101, red101]

describe('planPaymentVoid — the last payment first', () => {
  it('voiding the payoff reopens the ticket and leaves the due date alone', () => {
    expect(planPaymentVoid({ loan: redeemed, events: all, eventId: 'pay101' })).toEqual({
      ok: true,
      reversal: { amount: -101, principal_paid: -100, interest_paid: -1, fees_paid: 0, payment_method: 'cash' },
      restoreDueDate: null,
      reopens: true,
      newStatus: 'extended',
    })
  })

  it('an older payment waits until the newer one is voided', () => {
    expect(planPaymentVoid({ loan: redeemed, events: all, eventId: 'pay80' })).toEqual({ ok: false, reason: 'not_latest' })
    expect(voidablePaymentId({ loan: redeemed, events: all })).toBe('pay101')
  })

  it('then the payment before it: the due date goes back to where it was', () => {
    const void101 = ev({ id: 'void101', amount: -101, principal_paid: -100, interest_paid: -1, reverses_event_id: 'pay101', occurred_at: '2026-11-24T04:00:00.000Z' })
    const open = { ...redeemed, status: 'extended' as const }
    const events = [...all, void101]
    expect(voidablePaymentId({ loan: open, events })).toBe('pay80')
    expect(planPaymentVoid({ loan: open, events, eventId: 'pay80' })).toEqual({
      ok: true,
      reversal: { amount: -80, principal_paid: 0, interest_paid: -80, fees_paid: 0, payment_method: 'cash' },
      // No previous_due_date on that older row: the move before it says so.
      restoreDueDate: '2026-04-24',
      reopens: false,
      newStatus: 'extended',
    })
  })

  it('with both voided nothing is left to void, and the payoff is what it was', () => {
    const events = [
      ...all,
      ev({ id: 'void101', amount: -101, principal_paid: -100, interest_paid: -1, reverses_event_id: 'pay101', occurred_at: '2026-11-24T04:00:00.000Z' }),
      ev({ id: 'void80', amount: -80, interest_paid: -80, reverses_event_id: 'pay80', occurred_at: '2026-11-24T04:01:00.000Z' }),
      ev({ id: 'back', event_type: 'extension', amount: null, payment_method: null, new_due_date: '2026-04-24', previous_due_date: '2026-12-20', occurred_at: '2026-11-24T04:01:01.000Z' }),
    ]
    const open = { ...redeemed, status: 'extended' as const, due_date: '2026-04-24' }
    expect(voidablePaymentId({ loan: open, events })).toBeNull()
    expect(planPaymentVoid({ loan: open, events, eventId: 'pay80' })).toEqual({ ok: false, reason: 'already_voided' })

    // What is owed ignores the voided payments entirely.
    const FL: ChargeModel = { fullPeriods: 2, periodDays: 30, timezone: 'America/New_York' }
    const owed = (list: VoidEvent[]) =>
      payoffBalance({
        principal: 100,
        monthlyRate: 0.1,
        issueDate: '2025-09-24',
        today: '2026-11-23',
        events: list.map((e) => ({
          ...e,
          principal_paid: Number(e.principal_paid ?? 0),
          interest_paid: Number(e.interest_paid ?? 0),
          fees_paid: Number(e.fees_paid ?? 0),
          interest_waived: Number(e.interest_waived ?? 0),
        })),
        charge: FL,
      }).payoff
    expect(liveEvents(events).map((e) => e.id)).toEqual(['issued', 'old-pay', 'old-ext', 'ext80', 'red101', 'back'])
    expect(owed(events)).toBe(owed(old))
  })
})

describe('planPaymentVoid — what it refuses', () => {
  const open = { status: 'extended' as const, due_date: '2026-12-20', issue_date: '2025-09-24', term_days: 30 }
  const events = [...old, pay80, ext80]

  it('a payment from the old system, and anything that is not a payment', () => {
    expect(planPaymentVoid({ loan: open, events, eventId: 'old-pay' })).toEqual({ ok: false, reason: 'imported' })
    expect(planPaymentVoid({ loan: open, events, eventId: 'ext80' })).toEqual({ ok: false, reason: 'not_a_payment' })
    expect(planPaymentVoid({ loan: open, events, eventId: 'nope' })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('a payment made online', () => {
    const online = [...old, { ...pay80, stripe_session_id: 'cs_1' }, ext80]
    expect(planPaymentVoid({ loan: open, events: online, eventId: 'pay80' })).toEqual({ ok: false, reason: 'online' })
  })

  it('a payment with free time given after it', () => {
    const gift = ev({ id: 'gift', event_type: 'extension', amount: null, payment_method: null, interest_waived: 10, new_due_date: '2027-01-19', occurred_at: '2026-11-25T15:00:00.000Z' })
    const loan = { ...open, due_date: '2027-01-19' }
    expect(planPaymentVoid({ loan, events: [...events, gift], eventId: 'pay80' })).toEqual({ ok: false, reason: 'free_time_after' })
  })

  it('a payment on a forfeited or voided ticket, or one closed by something else', () => {
    expect(planPaymentVoid({ loan: { ...open, status: 'forfeited' }, events, eventId: 'pay80' })).toEqual({ ok: false, reason: 'loan_closed' })
    expect(planPaymentVoid({ loan: { ...open, status: 'voided' }, events, eventId: 'pay80' })).toEqual({ ok: false, reason: 'loan_closed' })
    // Paid off online afterwards: that payoff stands, so this one is not the last.
    const onlinePayoff = ev({ id: 'web', event_type: 'redemption', amount: 101, principal_paid: 100, interest_paid: 1, payment_method: 'card', stripe_session_id: 'cs_2', occurred_at: '2026-11-26T15:00:00.000Z' })
    expect(planPaymentVoid({ loan: { ...open, status: 'redeemed' }, events: [...events, onlinePayoff], eventId: 'pay80' })).toEqual({ ok: false, reason: 'not_latest' })
  })
})

describe('planPaymentVoid — a ticket written in Pawn', () => {
  const issued = ev({ id: 'issued', event_type: 'issued', amount: 300, payment_method: null, occurred_at: '2026-08-21T15:00:00.000Z' })

  it('uses the date written on the move, and the ticket is active again', () => {
    const pay = ev({ id: 'p', amount: 75, interest_paid: 75, occurred_at: '2026-09-20T15:00:00.000Z' })
    const ext = ev({ id: 'x', event_type: 'extension', amount: null, payment_method: null, new_due_date: '2026-10-20', previous_due_date: '2026-09-20', occurred_at: '2026-09-20T15:00:01.000Z' })
    const loan = { status: 'extended' as const, due_date: '2026-10-20', issue_date: '2026-08-21', term_days: 30 }
    expect(planPaymentVoid({ loan, events: [issued, pay, ext], eventId: 'p' })).toMatchObject({
      ok: true,
      restoreDueDate: '2026-09-20',
      reopens: false,
      newStatus: 'active',
    })
  })

  it('with nothing written on it, the first due date is the pawn date plus the term', () => {
    const pay = ev({ id: 'p', amount: 75, interest_paid: 75, occurred_at: '2026-09-20T15:00:00.000Z' })
    const ext = ev({ id: 'x', event_type: 'extension', amount: null, payment_method: null, new_due_date: '2026-10-20', occurred_at: '2026-09-20T15:00:01.000Z' })
    const loan = { status: 'extended' as const, due_date: '2026-10-20', issue_date: '2026-08-21', term_days: 30 }
    expect(planPaymentVoid({ loan, events: [issued, pay, ext], eventId: 'p' })).toMatchObject({ ok: true, restoreDueDate: '2026-09-20' })
  })

  it('a payment that did not move the date leaves it; another standing payment keeps the ticket "partial paid"', () => {
    const first = ev({ id: 'p1', amount: 50, principal_paid: 50, occurred_at: '2026-09-01T15:00:00.000Z' })
    const second = ev({ id: 'p2', amount: 20, principal_paid: 20, occurred_at: '2026-09-05T15:00:00.000Z' })
    const loan = { status: 'partial_paid' as const, due_date: '2026-09-20', issue_date: '2026-08-21', term_days: 30 }
    expect(planPaymentVoid({ loan, events: [issued, first, second], eventId: 'p2' })).toMatchObject({
      ok: true,
      restoreDueDate: null,
      newStatus: 'partial_paid',
      reversal: { amount: -20, principal_paid: -20, interest_paid: 0, fees_paid: 0 },
    })
    expect(planPaymentVoid({ loan, events: [issued, first, second], eventId: 'p1' })).toEqual({ ok: false, reason: 'not_latest' })
  })
})
