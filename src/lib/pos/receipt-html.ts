/**
 * Printable sale receipt as a self-contained HTML page (no PDF). The POS
 * loads it into a hidden frame and calls print() — the receipt goes to the
 * printer without opening a PDF viewer or a new tab.
 *
 * Two formats:
 *   - 'letter'  — a full 8.5x11 page, bilingual labels, for an office printer.
 *   - 'thermal' — the 40-column text layout from receipt-thermal.ts, in a
 *     monospace font sized so 40 characters fill the paper width.
 *
 * Pure: data in, HTML string out. Everything is escaped. Charcoal-on-paper
 * (reportColors), like every other printed document.
 */

import { reportColors } from '@/lib/tokens'
import type { SaleReceiptDoc } from './receipt-data'
import type { ReceiptFormat } from './receipt-format'
import {
  THERMAL_WIDTH,
  bi,
  cardDetail,
  layawayTerms,
  money,
  paymentLabel,
  shopDateTime,
  thermalReceiptLines,
  balanceOwed,
} from './receipt-thermal'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const e = escapeHtml

function page(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:${reportColors.body};-webkit-print-color-adjust:exact;print-color-adjust:exact}
${css}
</style>
</head>
<body>
${body}
</body>
</html>`
}

export function saleReceiptHtml(data: SaleReceiptDoc, format: ReceiptFormat): string {
  const p = data.i18n.en.pos.print
  const title = data.layaway
    ? `${p.layaway.header} ${data.layaway.layaway_number}`
    : `${p.header} ${data.sale_number}`
  return format === 'thermal' ? thermalHtml(data, title) : letterHtml(data, title)
}

// ── Thermal ────────────────────────────────────────────────────────────────

function thermalHtml(data: SaleReceiptDoc, title: string): string {
  const text = thermalReceiptLines(data, THERMAL_WIDTH).map(e).join('\n')
  // A monospace glyph is ~0.6em wide, so 40 columns ≈ 24em. Sizing the font
  // off the page width (vw = the printable width when printing) makes the
  // 40 columns fill whatever roll the driver reports, capped so a wide
  // preview stays readable.
  const css = `
@page{margin:0}
pre{margin:0;padding:0;white-space:pre;overflow:hidden;
font-family:"Courier New",Courier,"Lucida Console",monospace;
font-size:min(calc(100vw / ${(THERMAL_WIDTH * 0.6 + 0.6).toFixed(1)}), 14px);
line-height:1.2;color:#000;font-weight:600}
.feed{height:12mm}`
  return page(title, css, `<pre>${text}</pre><div class="feed"></div>`)
}

// ── Letter ─────────────────────────────────────────────────────────────────

function letterHtml(data: SaleReceiptDoc, title: string): string {
  const en = data.i18n.en.pos.print
  const es = data.i18n.es.pos.print
  const t = data.tenant
  const shop = t.dba?.trim() || t.name
  const address = [t.address, t.city, [t.state, t.zip].filter(Boolean).join(' ')]
    .filter((p) => p && p.trim())
    .join(', ')
  const contact = [t.phone, t.email].filter(Boolean).join(' · ')
  const customerName =
    data.customer?.full_name?.trim() || bi(en.customer.anonymous, es.customer.anonymous)
  const owed = balanceOwed(data)
  const terms = layawayTerms(data)

  const label = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase()
      ? e(a)
      : `${e(a)} <span class="es">/ ${e(b)}</span>`

  const itemRows = data.items
    .map(
      (it) => `<tr>
<td>${e(it.description)}${it.line_discount > 0 ? `<div class="sub">${label(en.totals.discount, es.totals.discount)} ${e(money(-it.line_discount))}</div>` : ''}</td>
<td class="mono">${e(it.sku ?? '—')}</td>
<td class="num">${e(String(Math.round(it.quantity * 1000) / 1000))}</td>
<td class="num">${e(money(it.unit_price))}</td>
<td class="num">${e(money(it.line_total))}</td>
</tr>`,
    )
    .join('')

  const paymentRows = data.payments
    .map((p) => {
      const card = cardDetail(p, en, es)
      const tip = (p.tip ?? 0) > 0 ? `<div class="line"><span>${label(en.tip, es.tip)}</span><span class="num">${e(money(p.tip ?? 0))}</span></div>` : ''
      return `<div class="line"><span>${e(paymentLabel(p.method, en, es))} · ${e(shopDateTime(p.occurred_at, data.timezone))}${card ? ` · <span class="mono">${e(card)}</span>` : ''}</span><span class="num">${e(money(p.amount))}</span></div>${tip}`
    })
    .join('')

  const css = `
@page{size:letter;margin:0.5in}
body{font-family:"DM Sans",Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.4}
.mono,.num{font-family:"JetBrains Mono","Courier New",monospace}
.num{text-align:right;white-space:nowrap}
.es{color:${reportColors.muted};font-weight:400}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.shop{font-size:18pt;font-weight:700;color:${reportColors.ink}}
.small{font-size:9pt;color:${reportColors.muted}}
.kicker{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:${reportColors.muted};text-align:right}
.number{font-family:"JetBrains Mono","Courier New",monospace;font-size:20pt;font-weight:700;color:${reportColors.ink};text-align:right}
hr{border:0;border-top:1px solid ${reportColors.divider};margin:14px 0}
h2{font-size:9pt;text-transform:uppercase;letter-spacing:.06em;color:${reportColors.ink};margin:0 0 6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}
.field .k{font-size:8pt;text-transform:uppercase;letter-spacing:.04em;color:${reportColors.muted}}
.field .v{color:${reportColors.ink}}
table{width:100%;border-collapse:collapse;font-size:10pt}
th{font-size:8pt;text-transform:uppercase;letter-spacing:.04em;color:${reportColors.ink};text-align:left;border-bottom:1px solid ${reportColors.ink};padding:4px 6px}
th.num{text-align:right}
td{border-bottom:1px solid ${reportColors.divider};padding:5px 6px;vertical-align:top;color:${reportColors.ink}}
.sub{font-size:8.5pt;color:${reportColors.muted}}
.totals{margin-left:auto;width:50%;margin-top:10px}
.line{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
.balance{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:10px;padding:10px 14px;border:2.5px solid ${reportColors.ink};border-radius:6px;color:${reportColors.ink};font-weight:700;font-size:14pt;text-transform:uppercase;letter-spacing:.03em}
.balance .num{font-size:24pt;letter-spacing:0}
.balance .es{font-weight:700}
.grand{border-top:1px solid ${reportColors.ink};margin-top:4px;padding-top:4px;font-weight:700;color:${reportColors.ink};font-size:12pt}
.policy{font-size:9pt}
.policy p{margin:4px 0}
.sign{margin-top:14px;page-break-inside:avoid;break-inside:avoid}
.sign p{margin:4px 0}
.sign-row{display:flex;gap:32px;margin-top:40px}
.sign-box{flex:1}
.sign-box.date{flex:0 0 30%}
.sign-line{border-bottom:1px solid ${reportColors.ink};height:0}
.sign .k{font-size:8pt;text-transform:uppercase;letter-spacing:.04em;color:${reportColors.muted};margin-top:4px}`

  const body = `
<div class="head">
  <div>
    <div class="shop">${e(shop)}</div>
    ${address ? `<div class="small">${e(address)}</div>` : ''}
    ${contact ? `<div class="small">${e(contact)}</div>` : ''}
  </div>
  <div>
    ${
      data.layaway
        ? `<div class="kicker">${label(en.layaway.header, es.layaway.header)}</div>
    <div class="number">${e(data.layaway.layaway_number || '—')}</div>
    <div class="small" style="text-align:right">${label(en.sections.sale, es.sections.sale)} <span class="mono">${e(data.sale_number || '—')}</span></div>`
        : `<div class="kicker">${label(en.header, es.header)}</div>
    <div class="number">${e(data.sale_number || '—')}</div>`
    }
    <div class="small" style="text-align:right">${e(shopDateTime(data.issued_at, data.timezone))}</div>
  </div>
</div>
<hr>
<div class="grid">
  <div class="field"><div class="k">${label(en.customer.name, es.customer.name)}</div><div class="v">${e(customerName)}</div></div>
  <div class="field"><div class="k">${label(en.customer.phone, es.customer.phone)}</div><div class="v">${e(data.customer?.phone ?? '—')}</div></div>
  <div class="field"><div class="k">${label(en.meta.kind, es.meta.kind)}</div><div class="v">${data.sale_kind === 'layaway' ? label(en.meta.kindLayaway, es.meta.kindLayaway) : label(en.meta.kindRetail, es.meta.kindRetail)}</div></div>
  <div class="field"><div class="k">${label(en.meta.taxRate, es.meta.taxRate)}</div><div class="v">${e(`${(data.tax_rate * 100).toFixed(2)}%`)}</div></div>
</div>
<hr>
<h2>${label(en.sections.items, es.sections.items)}</h2>
${
  data.items.length === 0
    ? `<p class="small">${label(en.itemsEmpty, es.itemsEmpty)}</p>`
    : `<table>
<thead><tr>
<th>${label(en.columns.description, es.columns.description)}</th>
<th>${label(en.columns.sku, es.columns.sku)}</th>
<th class="num">${label(en.columns.qty, es.columns.qty)}</th>
<th class="num">${label(en.columns.unit, es.columns.unit)}</th>
<th class="num">${label(en.columns.line, es.columns.line)}</th>
</tr></thead>
<tbody>${itemRows}</tbody>
</table>`
}
<div class="totals">
  <div class="line"><span>${label(en.totals.subtotal, es.totals.subtotal)}</span><span class="num">${e(money(data.subtotal))}</span></div>
  ${data.discount_amount > 0 ? `<div class="line"><span>${label(en.totals.discount, es.totals.discount)}</span><span class="num">${e(money(-data.discount_amount))}</span></div>` : ''}
  <div class="line"><span>${label(en.totals.tax, es.totals.tax)}</span><span class="num">${e(money(data.tax_amount))}</span></div>
  <div class="line grand"><span>${label(en.totals.total, es.totals.total)}</span><span class="num">${e(money(data.total))}</span></div>
</div>
<hr>
<h2>${label(en.sections.payments, es.sections.payments)}</h2>
${data.payments.length === 0 ? `<p class="small">${label(en.paymentsEmpty, es.paymentsEmpty)}</p>` : paymentRows}
<div class="totals">
  <div class="line grand"><span>${label(en.totals.paid, es.totals.paid)}</span><span class="num">${e(money(data.paid_total))}</span></div>
</div>
${owed ? `<div class="balance"><span>${label(owed.en, owed.es)}</span><span class="num">${e(money(owed.amount))}</span></div>` : ''}
${
  terms
    ? `<hr>
<h2>${label(en.layaway.terms, es.layaway.terms)}</h2>
<div class="grid">
${terms.rows.map(([k, v]) => `  <div class="field"><div class="k">${e(k)}</div><div class="v">${e(v)}</div></div>`).join('\n')}
</div>
<div class="policy" style="margin-top:8px">
  <p>${e(terms.policyEn)}</p>
  <p>${e(terms.policyEs)}</p>
</div>
<div class="sign">
  <p class="policy">${e(en.layaway.acknowledge)}</p>
  <p class="policy">${e(es.layaway.acknowledge)}</p>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line"></div><div class="k">${label(en.layaway.signature, es.layaway.signature)}</div></div>
    <div class="sign-box date"><div class="sign-line"></div><div class="k">${label(en.layaway.date, es.layaway.date)}</div></div>
  </div>
</div>`
    : ''
}
${data.notes?.trim() ? `<hr><h2>${label(en.notes, es.notes)}</h2><p>${e(data.notes)}</p>` : ''}
<hr>
<div class="policy">
  <h2>${label(en.returnPolicy.title, es.returnPolicy.title)}</h2>
  <p>${e(en.returnPolicy.body)}</p>
  <p>${e(es.returnPolicy.body)}</p>
</div>
<hr>
<p class="small" style="text-align:center">${label(en.thankYou, es.thankYou)}</p>`

  return page(title, css, body)
}
