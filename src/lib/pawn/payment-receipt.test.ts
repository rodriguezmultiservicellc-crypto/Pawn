import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import {
  paymentGroupReceiptHtml,
  paymentGroupReceiptLines,
  paymentGroupTotal,
  type PaymentGroupReceiptDoc,
  paymentReceiptFacts,
  paymentReceiptHtml,
  paymentReceiptLines,
  type PaymentReceiptDoc,
  type ReceiptEventInput,
} from './payment-receipt'

const ev = (over: Partial<ReceiptEventInput>): ReceiptEventInput => ({
  id: 'e',
  event_type: 'payment',
  amount: 0,
  principal_paid: 0,
  interest_paid: 0,
  fees_paid: 0,
  payment_method: 'cash',
  new_due_date: null,
  occurred_at: '2026-10-31T17:10:05.000Z',
  ...over,
})

const events: ReceiptEventInput[] = [
  ev({ id: 'issued', event_type: 'issued', amount: 1800, payment_method: null, occurred_at: '2026-08-22T17:01:40.000Z' }),
  ev({ id: 'p1', amount: 180, interest_paid: '180.0000', occurred_at: '2026-09-20T15:00:00.000Z' }),
  ev({ id: 'x1', event_type: 'extension', amount: null, payment_method: null, new_due_date: '2026-10-22', occurred_at: '2026-09-20T15:00:01.000Z' }),
  ev({ id: 'p2', amount: 100, principal_paid: 100, occurred_at: '2026-10-31T17:10:05.000Z' }),
  ev({ id: 'p3', amount: 1870, principal_paid: 1700, interest_paid: 170, occurred_at: '2026-11-20T15:00:00.000Z' }),
  ev({ id: 'r1', event_type: 'redemption', amount: null, payment_method: null, occurred_at: '2026-11-20T15:00:01.000Z' }),
]

describe('paymentReceiptFacts', () => {
  it('reads the recorded split and the principal left after that payment', () => {
    expect(paymentReceiptFacts({ principal: 1800, events, eventId: 'p2' })).toMatchObject({
      amount: 100,
      principal_paid: 100,
      interest_paid: 0,
      principal_balance: 1700,
      new_due_date: null,
      redeemed: false,
    })
  })

  it('an extension written right behind the payment is its new due date', () => {
    expect(paymentReceiptFacts({ principal: 1800, events, eventId: 'p1' })).toMatchObject({
      interest_paid: 180,
      principal_balance: 1800,
      new_due_date: '2026-10-22',
      redeemed: false,
    })
  })

  it('a redemption right behind the payment closes the ticket: nothing owed', () => {
    expect(paymentReceiptFacts({ principal: 1800, events, eventId: 'p3' })).toMatchObject({
      amount: 1870,
      principal_balance: 0,
      redeemed: true,
    })
  })

  it('does not borrow the extension of a LATER visit', () => {
    const later = [
      ev({ id: 'p1', amount: 20, interest_paid: 20, occurred_at: '2026-01-10T15:00:00.000Z' }),
      ev({ id: 'x', event_type: 'extension', new_due_date: '2026-03-01', occurred_at: '2026-01-12T15:00:00.000Z' }),
    ]
    expect(paymentReceiptFacts({ principal: 200, events: later, eventId: 'p1' })?.new_due_date).toBeNull()
  })

  it('is not a receipt for anything but a payment of this loan', () => {
    expect(paymentReceiptFacts({ principal: 1800, events, eventId: 'x1' })).toBeNull()
    expect(paymentReceiptFacts({ principal: 1800, events, eventId: 'nope' })).toBeNull()
  })

  it('works whatever order the events arrive in', () => {
    const shuffled = [events[4], events[1], events[5], events[0], events[3], events[2]]
    expect(paymentReceiptFacts({ principal: 1800, events: shuffled, eventId: 'p2' })?.principal_balance).toBe(1700)
  })
})

const doc = (eventId: string): PaymentReceiptDoc => ({
  ...paymentReceiptFacts({ principal: 1800, events, eventId })!,
  ticket_number: '15634',
  loan_principal: 1800,
  customer_name: 'Ana Diaz',
  tenant: { name: 'Shop Corp.', dba: "Eddy's Jewelers", address: '1 Main St', city: 'Tampa', state: 'FL', zip: '33602', phone: '(813) 555-0100' },
  timezone: 'America/New_York',
  i18n: { en, es },
})

describe('paymentReceiptLines', () => {
  it('never prints a line wider than the paper', () => {
    for (const id of ['p1', 'p2', 'p3']) {
      for (const l of paymentReceiptLines(doc(id), 40)) expect(l.length).toBeLessThanOrEqual(40)
    }
  })

  it('prints both languages, the amounts and the balance', () => {
    const text = paymentReceiptLines(doc('p2'), 40).join('\n')
    expect(text).toContain("EDDY'S JEWELERS")
    expect(text).toContain('15634')
    expect(text).toContain('Ana Diaz')
    expect(text).toContain('10/31/2026 1:10 PM')
    expect(text).toMatch(/TOTAL PAID \/ TOTAL PAGADO\s+\$100\.00/)
    expect(text).toMatch(/\$1,700\.00/)
    expect(text).toContain('Cash / Efectivo')
    // Nothing was paid toward interest: no $0.00 interest line.
    expect(text).not.toMatch(/Interest \/ Inter.s/)
  })

  it('says the new due date on an extension and the redemption on a payoff', () => {
    expect(paymentReceiptLines(doc('p1'), 40).join('\n')).toContain('10/22/2026')
    const paidOff = paymentReceiptLines(doc('p3'), 40).join('\n')
    expect(paidOff).toMatch(/REDEEMED/)
    expect(paidOff).not.toMatch(/Principal balance/)
  })

  it('a payoff that gives back unused interest says so, and still fits the paper', () => {
    // Paid off with $50.00 of interest paid ahead and not used.
    const closing = [
      ...events.filter((e) => e.id !== 'p3'),
      ev({ id: 'p3', amount: 1650, principal_paid: 1700, interest_paid: -50, occurred_at: '2026-11-20T15:00:00.000Z' }),
      ev({ id: 'r3', event_type: 'redemption', occurred_at: '2026-11-20T15:00:01.000Z' }),
    ]
    const d: PaymentReceiptDoc = {
      ...doc('p1'),
      ...paymentReceiptFacts({ principal: 1800, events: closing, eventId: 'p3' })!,
    }
    const lines = paymentReceiptLines(d, 40)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40)
    const text = lines.join('\n')
    expect(text).toMatch(/- \$50\.00/)
    expect(text).toMatch(/\$1,700\.00/)
    expect(text).toMatch(/TOTAL PAID \/ TOTAL PAGADO\s+\$1,650\.00/)
    // No plain "Interest" line for money that was given back.
    expect(text).not.toMatch(/^Interest \/ Inter.s/m)
  })
})

describe('paymentGroupReceipt (several tickets, one visit)', () => {
  const group: PaymentGroupReceiptDoc = {
    tickets: [
      { ...doc('p1'), ticket_number: '15634' },
      { ...doc('p2'), ticket_number: 'PT-015700' },
      { ...doc('p3'), ticket_number: '15990' },
    ],
  }

  it('adds the tickets up to one total', () => {
    expect(paymentGroupTotal(group)).toBe(2150)
  })

  it('fits the paper and prints every ticket with its own total, then the visit total', () => {
    const lines = paymentGroupReceiptLines(group, 40)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40)
    // Long bilingual labels wrap on 40 columns: read it as one run of words.
    const text = lines.join('\n').replace(/\s+/g, ' ')
    for (const n of ['15634', 'PT-015700', '15990']) expect(text).toContain(n)
    expect(text).toMatch(/Paid on this ticket \/ Pagado en este boleto \$180\.00/)
    expect(text).toMatch(/Paid on this ticket \/ Pagado en este boleto \$100\.00/)
    expect(text).toMatch(/Paid on this ticket \/ Pagado en este boleto \$1,870\.00/)
    expect(text).toMatch(/\$2,150\.00/)
    expect(text).toContain('10/22/2026')
    expect(text).toMatch(/REDEEMED/)
    expect(text).toContain('Ana Diaz')
  })

  it('escapes what it prints, in both formats', () => {
    const g = { tickets: group.tickets.map((t) => ({ ...t, customer_name: '<b>Ana</b>' })) }
    for (const format of ['thermal', 'letter'] as const) {
      const html = paymentGroupReceiptHtml(g, format)
      expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;')
      expect(html).not.toContain('<b>Ana</b>')
    }
  })
})

describe('paymentReceiptHtml', () => {
  it('escapes what it prints, in both formats', () => {
    const d = { ...doc('p2'), customer_name: '<b>Ana</b> & Co' }
    for (const format of ['thermal', 'letter'] as const) {
      const html = paymentReceiptHtml(d, format)
      expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt; &amp; Co')
      expect(html).not.toContain('<b>Ana</b>')
      expect(html.startsWith('<!doctype html>')).toBe(true)
    }
  })
})
