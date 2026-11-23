/**
 * Pawn payment receipt — what the customer takes home after paying on a
 * ticket, and what "Print receipt" on any past payment prints again.
 *
 * Pure: the loan and its events in, a receipt out. It reads what was
 * RECORDED — the split the payment event kept — and never refigures a
 * payment. Two derived facts only:
 *   - the principal still owed right after this payment (loan principal
 *     less every principal payment up to and including it), and
 *   - what the payment did: an extension or a redemption written right
 *     behind it (within FOLLOW_UP_MS) is part of the same visit.
 *
 * Bilingual on the same page (CLAUDE.md rule 6): every label prints
 * "English / Español". Formats follow the sale receipt: 'thermal' (40
 * columns) and 'letter'.
 */

import type { Dictionary } from '@/lib/i18n/en'
import { reportColors } from '@/lib/tokens'
import { escapeHtml, receiptPage, thermalReceiptPage } from '@/lib/pos/receipt-html'
import type { ReceiptFormat } from '@/lib/pos/receipt-format'
import { THERMAL_WIDTH, bi, calendarDate, center, money, paymentLabel, row, shopDateTime, wrap } from '@/lib/pos/receipt-thermal'

/** An extension / redemption this soon after a payment belongs to it. */
const FOLLOW_UP_MS = 120_000

export type ReceiptEventInput = {
  id: string
  event_type: string
  amount: number | string | null
  principal_paid: number | string
  interest_paid: number | string
  fees_paid: number | string
  payment_method: string | null
  new_due_date: string | null
  occurred_at: string
}

export type PaymentReceiptFacts = {
  event_id: string
  paid_at: string
  amount: number
  interest_paid: number
  principal_paid: number
  fees_paid: number
  payment_method: string | null
  /** Principal still owed right after this payment. */
  principal_balance: number
  /** Set when this payment extended the loan. */
  new_due_date: string | null
  /** This payment redeemed the ticket. */
  redeemed: boolean
}

export type PaymentReceiptDoc = PaymentReceiptFacts & {
  ticket_number: string
  loan_principal: number
  customer_name: string
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

const n = (v: number | string | null): number => {
  const x = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}
const r2 = (x: number): number => Math.round(x * 100) / 100

/** Null when `eventId` is not a payment of this loan. */
export function paymentReceiptFacts(args: {
  principal: number | string
  events: ReadonlyArray<ReceiptEventInput>
  eventId: string
}): PaymentReceiptFacts | null {
  const events = args.events
    .slice()
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0))
  const at = events.findIndex((e) => e.id === args.eventId)
  if (at < 0 || events[at].event_type !== 'payment') return null
  const pay = events[at]

  let principalPaid = 0
  for (let i = 0; i <= at; i++) principalPaid += n(events[i].principal_paid)

  let newDue: string | null = null
  let redeemed = false
  const t0 = Date.parse(pay.occurred_at)
  for (let i = at + 1; i < events.length; i++) {
    const e = events[i]
    if (e.event_type === 'payment' || Date.parse(e.occurred_at) - t0 > FOLLOW_UP_MS) break
    if (e.event_type === 'extension' && e.new_due_date) newDue = e.new_due_date
    if (e.event_type === 'redemption') redeemed = true
  }

  const interest = n(pay.interest_paid)
  const principal = n(pay.principal_paid)
  const fees = n(pay.fees_paid)
  return {
    event_id: pay.id,
    paid_at: pay.occurred_at,
    amount: pay.amount == null ? r2(interest + principal + fees) : n(pay.amount),
    interest_paid: interest,
    principal_paid: principal,
    fees_paid: fees,
    payment_method: pay.payment_method,
    principal_balance: redeemed ? 0 : r2(Math.max(0, n(args.principal) - principalPaid)),
    new_due_date: newDue,
    redeemed,
  }
}

type Labels = Dictionary['pawn']['detail']['receipt']

function shopLines(t: PaymentReceiptDoc['tenant']): { name: string; address: string | null; city: string | null; phone: string | null } {
  const city = [t.city, [t.state, t.zip].filter(Boolean).join(' ')].filter((p) => p && p.trim()).join(', ')
  return { name: t.dba?.trim() || t.name, address: t.address?.trim() || null, city: city || null, phone: t.phone?.trim() || null }
}

/** The rows of the receipt, shared by both formats so they cannot drift. */
function receiptRows(doc: PaymentReceiptDoc): {
  meta: Array<[string, string]>
  paid: Array<[string, string]>
  total: [string, string]
  after: Array<[string, string]>
  redeemed: string | null
  keep: string
} {
  const en: Labels = doc.i18n.en.pawn.detail.receipt
  const es: Labels = doc.i18n.es.pawn.detail.receipt
  const paid: Array<[string, string]> = []
  if (doc.interest_paid > 0) paid.push([bi(en.interest, es.interest), money(doc.interest_paid)])
  if (doc.principal_paid > 0) paid.push([bi(en.principal, es.principal), money(doc.principal_paid)])
  if (doc.fees_paid > 0) paid.push([bi(en.fees, es.fees), money(doc.fees_paid)])
  const after: Array<[string, string]> = [[bi(en.loanAmount, es.loanAmount), money(doc.loan_principal)]]
  if (!doc.redeemed) after.push([bi(en.principalBalance, es.principalBalance), money(doc.principal_balance)])
  if (doc.new_due_date) after.push([bi(en.newDueDate, es.newDueDate), calendarDate(doc.new_due_date)])
  const method = doc.payment_method
    ? paymentLabel(doc.payment_method, doc.i18n.en.pos.print, doc.i18n.es.pos.print)
    : null
  return {
    meta: [
      [bi(en.ticket, es.ticket), doc.ticket_number || '-'],
      [bi(en.date, es.date), shopDateTime(doc.paid_at, doc.timezone)],
      [bi(en.customer, es.customer), doc.customer_name],
      ...(method ? ([[bi(en.method, es.method), method]] as Array<[string, string]>) : []),
    ],
    paid,
    total: [bi(en.totalPaid, es.totalPaid).toUpperCase(), money(doc.amount)],
    after,
    redeemed: doc.redeemed ? bi(en.redeemed, es.redeemed) : null,
    keep: bi(en.keep, es.keep),
  }
}

/** 40-column text. Every line is at most `width` characters. */
export function paymentReceiptLines(doc: PaymentReceiptDoc, width: number = THERMAL_WIDTH): string[] {
  const en: Labels = doc.i18n.en.pawn.detail.receipt
  const es: Labels = doc.i18n.es.pawn.detail.receipt
  const W = width
  const rule = '-'.repeat(W)
  const heavy = '='.repeat(W)
  const rows = receiptRows(doc)
  const shop = shopLines(doc.tenant)
  const out: string[] = []
  out.push(...center(shop.name.toUpperCase(), W))
  if (shop.address) out.push(...center(shop.address, W))
  if (shop.city) out.push(...center(shop.city, W))
  if (shop.phone) out.push(...center(shop.phone, W))
  out.push(heavy)
  out.push(...center(bi(en.title, es.title).toUpperCase(), W))
  for (const [l, v] of rows.meta) out.push(...row(l, v, W))
  out.push(rule)
  for (const [l, v] of rows.paid) out.push(...row(l, v, W))
  out.push(...row(rows.total[0], rows.total[1], W))
  out.push(rule)
  for (const [l, v] of rows.after) out.push(...row(l, v, W))
  if (rows.redeemed) {
    out.push(rule)
    out.push(...center(rows.redeemed.toUpperCase(), W))
  }
  out.push(heavy)
  out.push(...wrap(rows.keep, W))
  return out
}

export function paymentReceiptHtml(doc: PaymentReceiptDoc, format: ReceiptFormat): string {
  const en: Labels = doc.i18n.en.pawn.detail.receipt
  const title = `${en.title} ${doc.ticket_number}`
  if (format === 'thermal') return thermalReceiptPage(title, paymentReceiptLines(doc, THERMAL_WIDTH))

  const e = escapeHtml
  const es: Labels = doc.i18n.es.pawn.detail.receipt
  const rows = receiptRows(doc)
  const shop = shopLines(doc.tenant)
  const line = ([l, v]: [string, string], cls = '') =>
    `<div class="line ${cls}"><span>${e(l)}</span><span class="num">${e(v)}</span></div>`
  const css = `
@page{size:letter;margin:0.6in}
body{font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.4}
.wrap{max-width:6.2in;margin:0 auto}
h1{font-size:18pt;margin:0;color:${reportColors.ink}}
.shop{font-size:10pt;color:${reportColors.muted}}
h2{font-size:13pt;margin:18pt 0 8pt;padding-bottom:4pt;border-bottom:1.5pt solid ${reportColors.ink};text-transform:uppercase;letter-spacing:.04em}
.line{display:flex;justify-content:space-between;gap:16pt;padding:3pt 0}
.num{font-family:"Courier New",Courier,monospace;font-weight:700;white-space:nowrap}
.total{margin-top:4pt;padding-top:6pt;border-top:1pt solid ${reportColors.divider};font-size:14pt;font-weight:700}
.box{margin-top:14pt;padding:8pt 10pt;border:1pt solid ${reportColors.divider};border-radius:6px}
.done{margin-top:12pt;text-align:center;font-weight:700;text-transform:uppercase}
.keep{margin-top:18pt;font-size:10pt;color:${reportColors.muted};text-align:center}`
  const body = `<div class="wrap">
<h1>${e(shop.name)}</h1>
<div class="shop">${[shop.address, shop.city, shop.phone].filter(Boolean).map((s) => e(s as string)).join(' · ')}</div>
<h2>${e(bi(en.title, es.title))}</h2>
${rows.meta.map((r) => line(r)).join('\n')}
<div class="box">
${rows.paid.map((r) => line(r)).join('\n')}
${line(rows.total, 'total')}
</div>
<div class="box">
${rows.after.map((r) => line(r)).join('\n')}
</div>
${rows.redeemed ? `<div class="done">${e(rows.redeemed)}</div>` : ''}
<div class="keep">${e(rows.keep)}</div>
</div>`
  return receiptPage(title, css, body)
}
