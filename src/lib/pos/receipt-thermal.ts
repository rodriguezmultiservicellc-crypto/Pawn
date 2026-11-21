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
import type { SaleReceiptPayment } from '@/lib/pdf/SaleReceiptPDF'
import type { SaleReceiptDoc } from './receipt-data'

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
  push(...center(bi(en.header, es.header).toUpperCase(), W))
  push(...row(bi(en.sections.sale, es.sections.sale), data.sale_number || '-', W))
  push(...wrap(shopDateTime(data.issued_at, data.timezone), W))
  if (data.sale_kind === 'layaway') {
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
  push(
    ...row(
      `${bi(en.totals.tax, es.totals.tax)} ${percent(data.tax_rate)}`,
      money(data.tax_amount),
      W,
    ),
  )
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
  }
  push(...row(bi(en.totals.paid, es.totals.paid), money(data.paid_total), W))
  const balance = Math.max(0, data.total - data.paid_total)
  if (balance > 0.005) {
    push(...row(bi(en.totals.balance, es.totals.balance), money(balance), W))
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
