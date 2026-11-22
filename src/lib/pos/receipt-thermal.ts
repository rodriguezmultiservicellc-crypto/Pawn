/**
 * Thermal sale receipt — a fixed-width text layout for a 40-column receipt
 * printer. Pure: data in, lines out. Every line is AT MOST `width`
 * characters, so the printer never wraps a line on its own and breaks the
 * column alignment.
 *
 * Bilingual per CLAUDE.md Rule 6: labels print "English / Español" (once,
 * when both are the same word), and the return policy prints in both
 * languages.
 *
 * Plain ASCII punctuation only for the layout itself ('-', '=', '*'):
 * receipt-printer fonts often lack bullets and box-drawing glyphs.
 */

import type { Dictionary } from '@/lib/i18n/en'
import type { SaleReceiptData, SaleReceiptPayment } from '@/lib/pdf/SaleReceiptPDF'
import type { SaleReceiptDoc } from './receipt-data'
import { isTaxExemptReason, saleTaxLines, type SaleTaxLine } from './sales-tax'

export const THERMAL_WIDTH = 40

type PrintDict = Dictionary['pos']['print']

/** "$1,234.56" / "-$1.00". */
export function money(n: number): string {
  if (!isFinite(n)) return '-'
  const abs = Math.abs(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `-${abs}` : abs
}

/** "Tax / Impuesto", or just "Subtotal" when both languages agree. */
export function bi(en: string, es: string): string {
  return en.trim().toLowerCase() === es.trim().toLowerCase() ? en : `${en} / ${es}`
}

/** Word-wrap to `width`; words longer than a line are hard-split. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const raw of para.split(/\s+/).filter(Boolean)) {
      let word = raw
      while (word.length > width) {
        if (line) {
          out.push(line)
          line = ''
        }
        out.push(word.slice(0, width))
        word = word.slice(width)
      }
      if (!word) continue
      if (!line) line = word
      else if (line.length + 1 + word.length <= width) line += ` ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out
}

/** Wrapped and indented two spaces under the line above. */
export function indented(text: string, width: number): string[] {
  return wrap(text, width - 2).map((l) => `  ${l}`)
}

export function center(text: string, width: number): string[] {
  return wrap(text, width).map((l) => {
    const pad = Math.floor((width - l.length) / 2)
    return `${' '.repeat(pad)}${l}`
  })
}

/**
 * Label on the left, value flush right. When both do not fit on one line,
 * the label wraps and the value goes right-aligned on the last label line
 * (or a line of its own).
 */
export function row(label: string, value: string, width: number): string[] {
  if (label.length + 1 + value.length <= width) {
    return [`${label}${' '.repeat(width - label.length - value.length)}${value}`]
  }
  const lines = wrap(label, width)
  const last = lines[lines.length - 1] ?? ''
  if (last.length + 1 + value.length <= width) {
    lines[lines.length - 1] = `${last}${' '.repeat(width - last.length - value.length)}${value}`
  } else {
    lines.push(value.length >= width ? value.slice(0, width) : `${' '.repeat(width - value.length)}${value}`)
  }
  return lines
}

function qty(q: number): string {
  const r = Math.round(q * 1000) / 1000
  return `${r}`
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

/** "11/21/2026 1:05 PM" in the shop's timezone. */
export function shopDateTime(iso: string, timezone: string): string {
  const d = new Date(iso)
  if (!isFinite(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).replace(',', '')
}

export function paymentLabel(method: string, en: PrintDict, es: PrintDict): string {
  const key: Record<string, keyof PrintDict['payment']> = {
    cash: 'cash',
    card: 'card',
    check: 'check',
    other: 'other',
    transfer: 'transfer',
    store_credit: 'storeCredit',
  }
  const k = key[method]
  return k ? bi(en.payment[k], es.payment[k]) : method
}

/** "VISA ****4242 Auth/Aut. AB12" — never more than the last 4 digits. */
export function cardDetail(p: SaleReceiptPayment, en: PrintDict, es: PrintDict): string | null {
  if (!p.card_last4) return null
  const brand = p.card_brand ? `${p.card_brand.toUpperCase()} ` : ''
  const auth = p.card_auth_code ? ` ${en.payment.authShort}/${es.payment.authShort} ${p.card_auth_code}` : ''
  return `${brand}****${p.card_last4}${auth}`
}

/** "12/21/2026" from a calendar date (YYYY-MM-DD) — no timezone shift. */
export function calendarDate(iso: string | null): string {
  if (!iso) return '-'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${m}/${d}/${y}` : iso
}

/**
 * What the customer still owes, for the large balance line every receipt
 * prints right under "Paid". A layaway reads its own balance; any other
 * sale owes total − paid. Null when nothing is owed.
 */
export function balanceOwed(data: SaleReceiptDoc): { en: string; es: string; amount: number } | null {
  const print = { en: data.i18n.en.pos.print, es: data.i18n.es.pos.print }
  if (data.layaway) {
    const amount = Math.max(0, data.layaway.balance_remaining)
    return amount > 0.005 ? { en: print.en.layaway.balance, es: print.es.layaway.balance, amount } : null
  }
  const amount = Math.max(0, data.total - data.paid_total)
  return amount > 0.005 ? { en: print.en.totals.balance, es: print.es.totals.balance, amount } : null
}

/**
 * What every receipt format prints about the sale's tax, under the totals:
 *   exempt  the sale was rung up tax exempt (patches/0097) — the label, the
 *           reason and the certificate number, each in both languages. The
 *           Tax line reads "Tax exempt" instead of a rate.
 *   lines   the tax by tax line ("FLDOR 6%", "Hillsborough 1.5%"), from what
 *           the sale itself kept (patches/0095). Empty when there is nothing
 *           to split.
 */
export function receiptTax(data: SaleReceiptData): {
  exempt: { en: string; es: string; reasonEn: string; reasonEs: string; certificate: string | null } | null
  lines: SaleTaxLine[]
} {
  const en = data.i18n.en.salesTax.exempt
  const es = data.i18n.es.salesTax.exempt
  const ex = data.tax_exempt
  if (!ex) return { exempt: null, lines: saleTaxLines(data.tax_breakdown, data.subtotal - data.discount_amount) }
  const known = isTaxExemptReason(ex.reason) ? ex.reason : null
  return {
    exempt: {
      en: en.label,
      es: es.label,
      reasonEn: known ? en.reasons[known] : ex.reason,
      reasonEs: known ? es.reasons[known] : ex.reason,
      certificate: ex.certificate?.trim()
        ? `${bi(en.certificateShort, es.certificateShort)} ${ex.certificate.trim()}`
        : null,
    },
    lines: [],
  }
}

/**
 * The layaway block shared by the Letter and Thermal receipts: bilingual
 * label/value rows plus the cancellation policy in each language. Null for
 * a plain sale.
 */
export function layawayTerms(data: SaleReceiptDoc): {
  rows: Array<[string, string]>
  policyEn: string
  policyEs: string
} | null {
  // The balance is NOT one of these rows: it is the number the customer
  // needs most, so each receipt prints it on its own, large (balanceOwed).
  const l = data.layaway
  if (!l) return null
  const en = data.i18n.en.pos.print.layaway
  const es = data.i18n.es.pos.print.layaway
  const kind = (['weekly', 'biweekly', 'monthly', 'custom'] as const).find((k) => k === l.schedule_kind)
  const pct = percent(l.cancellation_fee_pct)
  const rows: Array<[string, string]> = [
    [bi(en.schedule, es.schedule), kind ? bi(en.schedules[kind], es.schedules[kind]) : l.schedule_kind],
    [bi(en.firstDue, es.firstDue), calendarDate(l.first_payment_due)],
  ]
  if (l.final_due_date) rows.push([bi(en.finalDue, es.finalDue), calendarDate(l.final_due_date)])
  rows.push([bi(en.cancellationFee, es.cancellationFee), pct])
  const noFee = l.cancellation_fee_pct <= 0
  return {
    rows,
    policyEn: noFee ? en.policyNoFee : en.policy.replace('{pct}', pct),
    policyEs: noFee ? es.policyNoFee : es.policy.replace('{pct}', pct),
  }
}

export function thermalReceiptLines(data: SaleReceiptDoc, width: number = THERMAL_WIDTH): string[] {
  const en = data.i18n.en.pos.print
  const es = data.i18n.es.pos.print
  const W = width
  const rule = '-'.repeat(W)
  const heavy = '='.repeat(W)
  const out: string[] = []
  const push = (...lines: string[]) => out.push(...lines)

  // ── Shop header
  const t = data.tenant
  push(...center((t.dba?.trim() || t.name).toUpperCase(), W))
  if (t.address) push(...center(t.address, W))
  const cityLine = [t.city, [t.state, t.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (cityLine) push(...center(cityLine, W))
  if (t.phone) push(...center(t.phone, W))
  push(heavy)

  // ── Sale meta
  const terms = layawayTerms(data)
  if (data.layaway) {
    push(...center(bi(en.layaway.header, es.layaway.header).toUpperCase(), W))
    push(...row(bi(en.layaway.number, es.layaway.number), data.layaway.layaway_number || '-', W))
    push(...row(bi(en.sections.sale, es.sections.sale), data.sale_number || '-', W))
  } else {
    push(...center(bi(en.header, es.header).toUpperCase(), W))
    push(...row(bi(en.sections.sale, es.sections.sale), data.sale_number || '-', W))
  }
  push(...wrap(shopDateTime(data.issued_at, data.timezone), W))
  if (data.sale_kind === 'layaway' && !data.layaway) {
    push(...row(bi(en.meta.kind, es.meta.kind), bi(en.meta.kindLayaway, es.meta.kindLayaway), W))
  }
  const customerName = data.customer?.full_name?.trim()
  push(
    ...wrap(
      `${bi(en.customer.name, es.customer.name)}: ${customerName || bi(en.customer.anonymous, es.customer.anonymous)}`,
      W,
    ),
  )
  push(rule)

  // ── Items
  if (data.items.length === 0) {
    push(...wrap(bi(en.itemsEmpty, es.itemsEmpty), W))
  }
  for (const it of data.items) {
    push(...wrap(it.description, W))
    if (it.sku) push(...indented(`${en.columns.sku} ${it.sku}`, W))
    push(...row(`  ${qty(it.quantity)} x ${money(it.unit_price)}`, money(it.line_total), W))
    if (it.line_discount > 0) {
      push(...row(`  ${bi(en.totals.discount, es.totals.discount)}`, money(-it.line_discount), W))
    }
  }
  push(rule)

  // ── Totals
  push(...row(bi(en.totals.subtotal, es.totals.subtotal), money(data.subtotal), W))
  if (data.discount_amount > 0) {
    push(...row(bi(en.totals.discount, es.totals.discount), money(-data.discount_amount), W))
  }
  const tax = receiptTax(data)
  if (tax.exempt) {
    // No tax was charged, on purpose: say so, and why.
    push(...row(bi(tax.exempt.en, tax.exempt.es), money(data.tax_amount), W))
    push(...indented(bi(tax.exempt.reasonEn, tax.exempt.reasonEs), W))
    if (tax.exempt.certificate) push(...indented(tax.exempt.certificate, W))
  } else {
    push(
      ...row(
        `${bi(en.totals.tax, es.totals.tax)} ${percent(data.tax_rate)}`,
        money(data.tax_amount),
        W,
      ),
    )
    // The same tax, by who it is collected for (state, county, ...).
    for (const l of tax.lines) push(...row(`  ${l.label}`, money(l.tax), W))
  }
  push(heavy)
  push(...row(bi(en.totals.total, es.totals.total).toUpperCase(), money(data.total), W))
  push(heavy)

  // ── Payments
  if (data.payments.length === 0) {
    push(...wrap(bi(en.paymentsEmpty, es.paymentsEmpty), W))
  }
  for (const p of data.payments) {
    push(...row(paymentLabel(p.method, en, es), money(p.amount), W))
    const card = cardDetail(p, en, es)
    if (card) push(...indented(card, W))
    // A tip added on the card reader: charged on top of the payment above.
    if ((p.tip ?? 0) > 0) push(...row(bi(en.tip, es.tip), money(p.tip ?? 0), W))
  }
  push(...row(bi(en.totals.paid, es.totals.paid), money(data.paid_total), W))
  // What is still owed: boxed between heavy rules, in capitals, so it is the
  // first thing read on a strip of plain text.
  const owed = balanceOwed(data)
  if (owed) {
    push(heavy)
    push(...row(bi(owed.en, owed.es).toUpperCase(), money(owed.amount), W))
    push(heavy)
  }

  // ── Layaway terms
  if (terms) {
    push(rule)
    push(...center(bi(en.layaway.terms, es.layaway.terms).toUpperCase(), W))
    for (const [k, v] of terms.rows) push(...row(k, v, W))
    push('')
    push(...wrap(terms.policyEn, W))
    push('')
    push(...wrap(terms.policyEs, W))

    // Customer acknowledgement + signature, both languages.
    push(rule)
    push(...wrap(en.layaway.acknowledge, W))
    push('')
    push(...wrap(es.layaway.acknowledge, W))
    push('', '', '')
    push('_'.repeat(W))
    push(...wrap(bi(en.layaway.signature, es.layaway.signature), W))
    push('', '')
    push('_'.repeat(Math.min(W, 20)))
    push(...wrap(bi(en.layaway.date, es.layaway.date), W))
  }

  // ── Notes
  if (data.notes?.trim()) {
    push(rule)
    push(`${bi(en.notes, es.notes)}:`)
    push(...wrap(data.notes, W))
  }

  // ── Return policy, both languages
  push(rule)
  push(...wrap(`${en.returnPolicy.title}:`, W))
  push(...wrap(en.returnPolicy.body, W))
  push('')
  push(...wrap(`${es.returnPolicy.title}:`, W))
  push(...wrap(es.returnPolicy.body, W))
  push(rule)
  push(...center(bi(en.thankYou, es.thankYou), W))

  return out
}
