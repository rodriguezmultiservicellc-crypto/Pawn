/**
 * A ticket's payments, laid out the way the counter explains them to a
 * customer who says "I already paid": the pawn date, then one stretch of
 * time after another, and under each stretch the payment that paid for it —
 * its date and its amount. The last stretch, up to the due date, is the one
 * nobody has paid yet.
 *
 * Pure: the loan and its events in, the layout out. It reads what was
 * RECORDED and refigures nothing.
 *
 * How a payment is matched to its time. Interest is paid behind: paying the
 * interest of the stretch that ends at the due date is what moves the date.
 *   - A move made in Pawn pays up to one period before the new due date.
 *   - A move brought over from the old system (calendar months) paid the
 *     stretch that ended at the due date it moved FROM.
 * Either way the stretches join end to end from the pawn date, and whatever
 * is left before the current due date is not paid.
 *
 * Left out: a voided payment and everything it brought with it, and the row
 * that put the due date back (lib/pawn/payment-void). Payments that did not
 * move the date — money toward the loan, part of the interest, the payoff —
 * are listed separately; they paid for no stretch of time.
 */

import type { Dictionary } from '@/lib/i18n/en'
import { reportColors } from '@/lib/tokens'
import { escapeHtml, receiptPage } from '@/lib/pos/receipt-html'
import { bi, calendarDate, money } from '@/lib/pos/receipt-thermal'
import { addDaysIso, dayInTimezone } from '@/lib/pawn/math'
import { undoneEventIds } from '@/lib/pawn/payment-void'

type Money = number | string | null

export type HistoryEvent = {
  id: string
  event_type: string
  occurred_at: string
  amount: Money
  principal_paid: Money
  interest_paid: Money
  fees_paid: Money
  interest_waived: Money
  new_due_date: string | null
  previous_due_date: string | null
  reverses_event_id: string | null
  legacy_ref: string | null
}

export type HistoryPeriod = {
  /** The stretch of time this payment paid for. */
  from: string
  to: string
  /** 'paid' by a payment, 'free' time from a manager, or the date 'moved'
   *  with no payment on record. */
  kind: 'paid' | 'free' | 'moved'
  /** When (the instant) it was paid or given. */
  at: string
  /** Cash taken in that visit, and how it was booked. */
  amount: number
  interest: number
  principal: number
  fees: number
  /** Interest not charged (free time). */
  waived: number
  /** Where the due date went. */
  due_moved_to: string
}

export type OtherPayment = {
  at: string
  amount: number
  interest: number
  principal: number
  fees: number
  /** This payment paid the ticket off. */
  payoff: boolean
}

export type PaymentHistory = {
  pawn_date: string
  periods: HistoryPeriod[]
  /** The time not paid for yet, up to the due date. Null on a closed ticket. */
  open: { from: string; to: string } | null
  other: OtherPayment[]
  /** Every dollar the customer paid on this ticket (voided payments out). */
  total_paid: number
}

const n = (v: Money): number => {
  const x = typeof v === 'string' ? parseFloat(v) : (v ?? 0)
  return isFinite(x) ? x : 0
}
const r2 = (x: number): number => Math.round(x * 100) / 100

export function buildPaymentHistory(args: {
  issueDate: string
  dueDate: string
  termDays: number
  /** Days in one period (the jurisdiction's). */
  periodDays: number
  /** Open tickets show the stretch not paid yet. */
  isOpen: boolean
  events: ReadonlyArray<HistoryEvent>
}): PaymentHistory {
  const events = [...args.events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  )
  const undone = undoneEventIds(events)
  const stands = (e: HistoryEvent) => !e.reverses_event_id && !undone.has(e.id)

  const periods: HistoryPeriod[] = []
  const other: OtherPayment[] = []
  let total = 0
  let paidTo = args.issueDate // the end of the last stretch paid for
  let due: string | null = null // the due date as the moves leave it
  let pending: HistoryEvent | null = null // a payment waiting for its move

  const asOther = (e: HistoryEvent, payoff: boolean) =>
    other.push({
      at: e.occurred_at,
      amount: r2(n(e.amount ?? n(e.principal_paid) + n(e.interest_paid) + n(e.fees_paid))),
      interest: r2(n(e.interest_paid)),
      principal: r2(n(e.principal_paid)),
      fees: r2(n(e.fees_paid)),
      payoff,
    })

  for (const e of events) {
    if (!stands(e)) continue
    if (e.event_type === 'payment') {
      if (pending) asOther(pending, false)
      pending = e
      total += n(e.amount ?? n(e.principal_paid) + n(e.interest_paid) + n(e.fees_paid))
      continue
    }
    if (e.event_type === 'redemption') {
      // Paid off at the counter (the payment row before it) or online (the
      // redemption row carries the money itself).
      if (pending) {
        asOther(pending, true)
        pending = null
      } else if (n(e.principal_paid) !== 0 || n(e.interest_paid) !== 0) {
        total += n(e.amount ?? n(e.principal_paid) + n(e.interest_paid) + n(e.fees_paid))
        asOther(e, true)
      }
      continue
    }
    if (e.event_type !== 'extension' || !e.new_due_date) continue

    const movedFrom: string =
      e.previous_due_date ??
      due ??
      (() => {
        const first = addDaysIso(args.issueDate, Math.max(0, args.termDays))
        return first < e.new_due_date ? first : args.issueDate
      })()
    // The row that put a due date back after a void moves it backwards.
    if (e.new_due_date < movedFrom) {
      due = e.new_due_date
      continue
    }
    let to = e.legacy_ref ? movedFrom : addDaysIso(e.new_due_date, -args.periodDays)
    if (to < paidTo) to = paidTo
    const free = n(e.interest_waived) > 0
    const pay = free ? null : pending
    periods.push({
      from: paidTo,
      to,
      kind: free ? 'free' : pay ? 'paid' : 'moved',
      at: pay ? pay.occurred_at : e.occurred_at,
      amount: pay ? r2(n(pay.amount ?? n(pay.principal_paid) + n(pay.interest_paid) + n(pay.fees_paid))) : 0,
      interest: pay ? r2(n(pay.interest_paid)) : 0,
      principal: pay ? r2(n(pay.principal_paid)) : 0,
      fees: pay ? r2(n(pay.fees_paid)) : 0,
      waived: r2(n(e.interest_waived)),
      due_moved_to: e.new_due_date,
    })
    if (!free) pending = null
    paidTo = to
    due = e.new_due_date
  }
  if (pending) asOther(pending, false)

  return {
    pawn_date: args.issueDate,
    periods,
    open: args.isOpen ? { from: paidTo, to: args.dueDate > paidTo ? args.dueDate : paidTo } : null,
    other,
    total_paid: r2(total),
  }
}

// ── The page handed to the customer ────────────────────────────────────────

export type PaymentHistoryDoc = {
  history: PaymentHistory
  ticket_number: string
  loan_principal: number
  customer_name: string
  due_date: string
  /** Interest owed as of today; null on a closed ticket. */
  interest_owed: number | null
  /** Everything it takes to redeem today; null on a closed ticket. */
  payoff: number | null
  /** The shop's day it was printed. */
  printed_on: string
  tenant: {
    name: string
    dba: string | null
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
    phone: string | null
  }
  timezone: string
  i18n: { en: Dictionary; es: Dictionary }
}

type Labels = Dictionary['pawn']['detail']['history']

/** Letter page, English / Español on the same sheet (rule 6). */
export function paymentHistoryHtml(doc: PaymentHistoryDoc): string {
  const en: Labels = doc.i18n.en.pawn.detail.history
  const es: Labels = doc.i18n.es.pawn.detail.history
  const e = escapeHtml
  const h = doc.history
  const day = (instant: string) => calendarDate(dayInTimezone(instant, doc.timezone))
  const t = doc.tenant
  const city = [t.city, [t.state, t.zip].filter(Boolean).join(' ')].filter((p) => p && p.trim()).join(', ')
  const shop = [t.address?.trim(), city, t.phone?.trim()].filter(Boolean) as string[]

  const what = (p: HistoryPeriod): string =>
    p.kind === 'free'
      ? `${bi(en.free, es.free)} (${money(p.waived)})`
      : p.kind === 'moved'
        ? bi(en.moved, es.moved)
        : p.principal > 0
          ? `${money(p.amount)} (${bi(en.towardLoan, es.towardLoan)}: ${money(p.principal)})`
          : money(p.amount)

  const rows = h.periods
    .map(
      (p) => `<tr>
<td class="num">${e(calendarDate(p.from))} &rarr; ${e(calendarDate(p.to))}</td>
<td class="num">${e(day(p.at))}</td>
<td class="num r">${e(what(p))}</td>
</tr>`,
    )
    .join('\n')
  const openRow = h.open
    ? `<tr class="open">
<td class="num">${e(calendarDate(h.open.from))} &rarr; ${e(calendarDate(h.open.to))}</td>
<td>${e(bi(en.notPaid, es.notPaid).toUpperCase())}</td>
<td class="num r">${doc.interest_owed != null ? e(`${bi(en.owedToday, es.owedToday)}: ${money(doc.interest_owed)}`) : ''}</td>
</tr>`
    : ''
  const others = h.other.length
    ? `<h2>${e(bi(en.other, es.other))}</h2>
<table>
${h.other
  .map(
    (o) => `<tr>
<td class="num">${e(day(o.at))}</td>
<td>${e(o.payoff ? bi(en.payoff, es.payoff) : o.principal > 0 ? bi(en.towardLoan, es.towardLoan) : bi(en.interest, es.interest))}</td>
<td class="num r">${e(money(o.amount))}</td>
</tr>`,
  )
  .join('\n')}
</table>`
    : ''

  const line = (l: string, v: string, cls = '') =>
    `<div class="line ${cls}"><span>${e(l)}</span><span class="num">${e(v)}</span></div>`
  const css = `
@page{size:letter;margin:0.6in}
body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.35}
.wrap{max-width:7in;margin:0 auto}
h1{font-size:18pt;margin:0;color:${reportColors.ink}}
.shop{font-size:10pt;color:${reportColors.muted}}
h2{font-size:12pt;margin:16pt 0 6pt;padding-bottom:4pt;border-bottom:1.5pt solid ${reportColors.ink};text-transform:uppercase;letter-spacing:.04em}
.line{display:flex;justify-content:space-between;gap:16pt;padding:2pt 0}
.num{font-family:"Courier New",Courier,monospace;font-weight:700;white-space:nowrap}
table{width:100%;border-collapse:collapse}
th{font-size:9pt;text-align:left;color:${reportColors.muted};font-weight:400;padding:3pt 4pt;border-bottom:1pt solid ${reportColors.divider}}
td{padding:4pt;border-bottom:.5pt solid ${reportColors.divider};vertical-align:top}
.r{text-align:right;white-space:normal}
tr.open td{border:1.5pt solid ${reportColors.ink};font-weight:700}
.total{margin-top:6pt;font-size:13pt;font-weight:700}
.note{margin-top:14pt;font-size:9pt;color:${reportColors.muted}}`
  const title = `${en.statementTitle} ${doc.ticket_number}`
  const body = `<div class="wrap">
<h1>${e(t.dba?.trim() || t.name)}</h1>
<div class="shop">${shop.map((s) => e(s)).join(' · ')}</div>
<h2>${e(bi(en.statementTitle, es.statementTitle))}</h2>
${line(bi(en.ticket, es.ticket), doc.ticket_number || '-')}
${line(bi(en.customer, es.customer), doc.customer_name)}
${line(bi(en.pawned, es.pawned), `${calendarDate(h.pawn_date)} · ${money(doc.loan_principal)}`)}
${line(bi(en.dueOn, es.dueOn), calendarDate(doc.due_date))}
<h2>${e(bi(en.title, es.title))}</h2>
<table>
<tr><th>${e(bi(en.period, es.period))}</th><th>${e(bi(en.paidOn, es.paidOn))}</th><th class="r">${e(bi(en.amount, es.amount))}</th></tr>
${rows}
${openRow}
</table>
${others}
<div class="line total"><span>${e(bi(en.totalPaid, es.totalPaid))}</span><span class="num">${e(money(h.total_paid))}</span></div>
${doc.payoff != null ? line(bi(en.payoffToday, es.payoffToday), money(doc.payoff), 'total') : ''}
<div class="note">${e(bi(en.printedOn, es.printedOn))}: ${e(calendarDate(doc.printed_on))}</div>
</div>`
  return receiptPage(title, css, body)
}
