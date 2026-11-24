/**
 * The payment history a clerk shows a customer who says "I already paid":
 * stretches of time end to end from the pawn date, each with the payment
 * that paid for it, and the stretch nobody has paid yet.
 */

import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { buildPaymentHistory, paymentHistoryHtml, type HistoryEvent, type PaymentHistoryDoc } from './payment-history'

const ev = (over: Partial<HistoryEvent>): HistoryEvent => ({
  id: 'e',
  event_type: 'payment',
  occurred_at: '2026-01-01T15:00:00.000Z',
  amount: 0,
  principal_paid: 0,
  interest_paid: 0,
  fees_paid: 0,
  interest_waived: 0,
  new_due_date: null,
  previous_due_date: null,
  reverses_event_id: null,
  legacy_ref: null,
  ...over,
})
const pay = (id: string, day: string, over: Partial<HistoryEvent> = {}) =>
  ev({ id, occurred_at: `${day}T15:00:00.000Z`, ...over })
const move = (id: string, day: string, to: string, over: Partial<HistoryEvent> = {}) =>
  ev({ id, event_type: 'extension', amount: null, occurred_at: `${day}T15:00:01.000Z`, new_due_date: to, ...over })

describe('buildPaymentHistory — the sketch: pawn 1/1, due 2/1, 3/1, 4/1', () => {
  // The old system's tickets move by calendar months.
  const legacy = { legacy_ref: 'xpawn' }
  const events = [
    ev({ id: 'issued', event_type: 'issued', amount: 300, occurred_at: '2026-01-01T15:00:00.000Z', ...legacy }),
    pay('p1', '2026-01-28', { amount: 30, interest_paid: 30, ...legacy }),
    move('x1', '2026-01-28', '2026-03-01', legacy),
    pay('p2', '2026-03-02', { amount: 30, interest_paid: 30, ...legacy }),
    move('x2', '2026-03-02', '2026-04-01', legacy),
  ]
  const h = buildPaymentHistory({ issueDate: '2026-01-01', dueDate: '2026-04-01', termDays: 31, periodDays: 30, isOpen: true, events })

  it('each month has the payment that paid for it', () => {
    expect(h.pawn_date).toBe('2026-01-01')
    expect(h.periods.map((p) => [p.from, p.to, p.kind, p.at.slice(0, 10), p.amount])).toEqual([
      ['2026-01-01', '2026-02-01', 'paid', '2026-01-28', 30],
      ['2026-02-01', '2026-03-01', 'paid', '2026-03-02', 30],
    ])
  })

  it('the last month, up to the due date, is the one not paid', () => {
    expect(h.open).toEqual({ from: '2026-03-01', to: '2026-04-01' })
    expect(h.total_paid).toBe(60)
    expect(h.other).toEqual([])
  })
})

describe('buildPaymentHistory — payments taken in Pawn', () => {
  it('ticket 15551: one payment of eight periods pays up to a period before the new due date', () => {
    const events = [
      ev({ id: 'issued', event_type: 'issued', amount: 100, occurred_at: '2025-09-24T15:00:00.000Z', legacy_ref: 'x' }),
      pay('old', '2026-03-02', { amount: 10, interest_paid: 10, legacy_ref: 'x' }),
      move('oldx', '2026-03-02', '2026-04-24', { legacy_ref: 'x', previous_due_date: null }),
      pay('p80', '2026-11-23', { amount: 80, interest_paid: 80 }),
      move('x80', '2026-11-23', '2026-12-20'),
    ]
    const h = buildPaymentHistory({ issueDate: '2025-09-24', dueDate: '2026-12-20', termDays: 30, periodDays: 30, isOpen: true, events })
    const last = h.periods[h.periods.length - 1]
    expect([last.to, last.amount]).toEqual(['2026-11-20', 80])
    // Stretches join end to end.
    expect(last.from).toBe(h.periods[0].to)
    expect(h.open).toEqual({ from: '2026-11-20', to: '2026-12-20' })
  })

  it('money toward the loan and the payoff are listed apart: they paid for no time', () => {
    const events = [
      ev({ id: 'issued', event_type: 'issued', amount: 300, occurred_at: '2026-08-21T15:00:00.000Z' }),
      pay('down', '2026-09-01', { amount: 50, principal_paid: 50 }),
      pay('p1', '2026-09-20', { amount: 175, interest_paid: 75, principal_paid: 100 }),
      move('x1', '2026-09-20', '2026-10-20', { previous_due_date: '2026-09-20' }),
      pay('off', '2026-10-05', { amount: 187.5, interest_paid: 37.5, principal_paid: 150 }),
      ev({ id: 'red', event_type: 'redemption', amount: null, occurred_at: '2026-10-05T15:00:01.000Z' }),
    ]
    const h = buildPaymentHistory({ issueDate: '2026-08-21', dueDate: '2026-10-20', termDays: 30, periodDays: 30, isOpen: false, events })
    expect(h.periods).toHaveLength(1)
    expect(h.periods[0]).toMatchObject({ from: '2026-08-21', to: '2026-09-20', amount: 175, principal: 100 })
    expect(h.other).toEqual([
      { at: '2026-09-01T15:00:00.000Z', amount: 50, principal: 50, payoff: false },
      { at: '2026-10-05T15:00:00.000Z', amount: 187.5, principal: 150, payoff: true },
    ])
    // A closed ticket has no stretch left to pay.
    expect(h.open).toBeNull()
    expect(h.total_paid).toBe(412.5)
  })

  it('free time is its own box and takes no money', () => {
    const events = [
      ev({ id: 'issued', event_type: 'issued', amount: 1000, occurred_at: '2026-08-21T15:00:00.000Z' }),
      move('gift', '2026-09-20', '2026-10-20', { interest_waived: 250, previous_due_date: '2026-09-20' }),
    ]
    const h = buildPaymentHistory({ issueDate: '2026-08-21', dueDate: '2026-10-20', termDays: 30, periodDays: 30, isOpen: true, events })
    expect(h.periods).toEqual([
      expect.objectContaining({ kind: 'free', from: '2026-08-21', to: '2026-09-20', amount: 0, waived: 250 }),
    ])
    expect(h.total_paid).toBe(0)
  })

  it('a voided payment, its move and the row that put the date back are all left out', () => {
    const events = [
      ev({ id: 'issued', event_type: 'issued', amount: 300, occurred_at: '2026-08-21T15:00:00.000Z' }),
      pay('p1', '2026-09-20', { amount: 75, interest_paid: 75 }),
      move('x1', '2026-09-20', '2026-10-20', { previous_due_date: '2026-09-20' }),
      ev({ id: 'void', occurred_at: '2026-09-20T16:00:00.000Z', amount: -75, interest_paid: -75, reverses_event_id: 'p1' }),
      ev({ id: 'back', event_type: 'extension', amount: null, occurred_at: '2026-09-20T16:00:01.000Z', new_due_date: '2026-09-20', previous_due_date: '2026-10-20' }),
    ]
    const h = buildPaymentHistory({ issueDate: '2026-08-21', dueDate: '2026-09-20', termDays: 30, periodDays: 30, isOpen: true, events })
    expect(h.periods).toEqual([])
    expect(h.other).toEqual([])
    expect(h.total_paid).toBe(0)
    expect(h.open).toEqual({ from: '2026-08-21', to: '2026-09-20' })
  })

  it('a ticket nobody has paid on: one stretch, from the pawn date to the due date', () => {
    const h = buildPaymentHistory({ issueDate: '2026-08-21', dueDate: '2026-09-20', termDays: 30, periodDays: 30, isOpen: true, events: [] })
    expect(h).toEqual({ pawn_date: '2026-08-21', periods: [], open: { from: '2026-08-21', to: '2026-09-20' }, other: [], total_paid: 0 })
  })
})

describe('paymentHistoryHtml', () => {
  const doc: PaymentHistoryDoc = {
    history: buildPaymentHistory({
      issueDate: '2026-01-01',
      dueDate: '2026-04-01',
      termDays: 31,
      periodDays: 30,
      isOpen: true,
      events: [
        pay('p1', '2026-01-28', { amount: 30, interest_paid: 30, legacy_ref: 'x' }),
        move('x1', '2026-01-28', '2026-03-01', { legacy_ref: 'x' }),
      ],
    }),
    ticket_number: '15634',
    loan_principal: 300,
    customer_name: 'Ana <Diaz>',
    due_date: '2026-04-01',
    interest_owed: 60,
    payoff: 360,
    printed_on: '2026-04-10',
    tenant: { name: 'Shop Corp.', dba: "Eddy's Jewelers", address: '1 Main St', city: 'Tampa', state: 'FL', zip: '33602', phone: '(813) 555-0100' },
    timezone: 'America/New_York',
    i18n: { en, es },
  }
  const html = paymentHistoryHtml(doc)

  it('prints both languages, the paid stretch and the one not paid', () => {
    expect(html).toContain('Payment history / Historial de pagos')
    expect(html).toContain('01/01/2026 &rarr; 02/01/2026')
    expect(html).toContain('01/28/2026')
    expect(html).toContain('$30.00')
    expect(html).toContain('NOT PAID / NO PAGADO')
    expect(html).toContain('$60.00')
    expect(html).toContain('$360.00')
  })

  it('escapes what it prints', () => {
    expect(html).toContain('Ana &lt;Diaz&gt;')
    expect(html).not.toContain('Ana <Diaz>')
  })
})
