import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import type { SaleReceiptDoc } from './receipt-data'
import { bi, center, row, thermalReceiptLines, wrap } from './receipt-thermal'
import { escapeHtml, saleReceiptHtml } from './receipt-html'

function doc(over: Partial<SaleReceiptDoc> = {}): SaleReceiptDoc {
  return {
    sale_number: 'S-000007',
    status: 'completed',
    is_locked: true,
    sale_kind: 'retail',
    subtotal: 1250,
    discount_amount: 50,
    tax_rate: 0.075,
    tax_amount: 90,
    total: 1290,
    paid_total: 1290,
    notes: 'Customer asked for a gift box with a ribbon and a card.',
    customer: { full_name: 'Maria Fernanda Gonzalez-Rodriguez de la Cruz', phone: '813-555-0100', email: null },
    tenant: {
      name: 'Sol Pawn & Jewelry',
      dba: null,
      address: '1234 West Hillsborough Avenue Suite 100',
      city: 'Tampa',
      state: 'FL',
      zip: '33614',
      phone: '(813) 555-0199',
      email: null,
    },
    items: [
      {
        description: '14K yellow gold Cuban link chain 22 inch 8mm with lobster clasp',
        sku: 'INV-0004521',
        quantity: 1,
        unit_price: 1200,
        line_discount: 0,
        line_total: 1200,
      },
      { description: 'Ring sizing', sku: null, quantity: 2, unit_price: 25, line_discount: 5, line_total: 45 },
    ],
    payments: [
      { amount: 1000, method: 'card', occurred_at: '2026-11-21T18:05:00Z', card_last4: '4242', card_brand: 'visa', card_auth_code: 'AB12CD' },
      { amount: 290, method: 'cash', occurred_at: '2026-11-21T18:06:00Z' },
    ],
    i18n: { en, es },
    printed_on: '2026-11-21',
    issued_at: '2026-11-21T18:06:00Z',
    timezone: 'America/New_York',
    layaway: null,
    ...over,
  }
}

const LAYAWAY = {
  layaway_number: 'L-000001',
  status: 'active',
  schedule_kind: 'monthly',
  first_payment_due: '2026-12-21',
  final_due_date: '2027-03-21',
  cancellation_fee_pct: 0.1,
  balance_remaining: 290,
}

describe('thermal layout helpers', () => {
  it('wrap never exceeds the width and hard-splits long words', () => {
    const lines = wrap('a '.repeat(30) + 'x'.repeat(95), 40)
    expect(lines.every((l) => l.length <= 40)).toBe(true)
    expect(lines.join('').replace(/\s/g, '')).toBe('a'.repeat(30) + 'x'.repeat(95))
  })

  it('row right-aligns the value on one line when it fits', () => {
    expect(row('Total', '$12.00', 40)).toEqual([`Total${' '.repeat(29)}$12.00`])
    expect(row('Total', '$12.00', 40)[0]).toHaveLength(40)
  })

  it('row wraps a long label and keeps the value flush right', () => {
    const lines = row('Balance due / Saldo pendiente extra words', '$1,234.56', 40)
    expect(lines.every((l) => l.length <= 40)).toBe(true)
    expect(lines[lines.length - 1].endsWith('$1,234.56')).toBe(true)
  })

  it('center pads to the middle', () => {
    expect(center('AB', 10)).toEqual(['    AB'])
  })

  it('bi prints one word when both languages agree', () => {
    expect(bi('Subtotal', 'Subtotal')).toBe('Subtotal')
    expect(bi('Tax', 'Impuesto')).toBe('Tax / Impuesto')
  })
})

describe('thermalReceiptLines', () => {
  const lines = thermalReceiptLines(doc())
  const text = lines.join('\n')

  it('every line fits in 40 columns', () => {
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40)
  })

  it('prints the totals right-aligned at column 40', () => {
    const total = lines.find((l) => l.startsWith('TOTAL'))
    expect(total).toBeDefined()
    expect(total).toHaveLength(40)
    expect(total!.endsWith('$1,290.00')).toBe(true)
  })

  it('is bilingual', () => {
    expect(text).toContain('SALES RECEIPT / RECIBO DE VENTA')
    expect(text).toContain('Tax / Impuesto')
    expect(text).toContain(en.pos.print.returnPolicy.title)
    expect(text).toContain(es.pos.print.returnPolicy.title)
  })

  it('shows the card as last 4 only, and the time in the shop timezone', () => {
    expect(text).toContain('VISA ****4242')
    expect(text).toContain('11/21/2026 1:06 PM')
  })

  it('shows a balance line only when money is still owed', () => {
    expect(text.toUpperCase()).not.toContain(en.pos.print.totals.balance.toUpperCase())
    const owing = thermalReceiptLines(doc({ paid_total: 1000 }))
    // In capitals, boxed between heavy rules, so it stands out on plain text.
    const at = owing.findIndex((l) => l.includes(en.pos.print.totals.balance.toUpperCase()))
    expect(at).toBeGreaterThan(0)
    const end = owing.findIndex((l, i) => i > at && l === '='.repeat(40))
    expect(owing[at - 1]).toBe('='.repeat(40))
    expect(end).toBeGreaterThan(at)
    expect(owing.slice(at, end).join(' ')).toContain('$290.00')
  })

  it('names a walk-in when there is no customer', () => {
    const anon = thermalReceiptLines(doc({ customer: null })).join('\n')
    expect(anon).toContain(en.pos.print.customer.anonymous)
  })
})

describe('layaway receipt', () => {
  const lay = doc({ sale_kind: 'layaway', paid_total: 1000, layaway: LAYAWAY })
  const lines = thermalReceiptLines(lay)
  const text = lines.join('\n')

  it('every line fits in 40 columns', () => {
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40)
  })

  it('leads with the layaway number and keeps the sale number', () => {
    expect(text).toContain('LAYAWAY RECEIPT / RECIBO DE APARTADO')
    expect(text).toContain('L-000001')
    expect(text).toContain('S-000007')
  })

  it('prints the terms bilingual, dates without a timezone shift', () => {
    expect(text).toContain('Monthly / Mensual')
    expect(text).toContain('12/21/2026')
    expect(text).toContain('03/21/2027')
    expect(text).toContain('10%')
    expect(text).toContain('$290.00')
    expect(text).toContain(en.pos.print.layaway.policy.replace('{pct}', '10%').slice(0, 30))
    expect(text.replace(/\s+/g, ' ')).toContain(es.pos.print.layaway.policy.replace('{pct}', '10%'))
  })

  it('prints the balance once, large, right under what was paid', () => {
    const label = en.pos.print.layaway.balance.toUpperCase()
    const at = lines.findIndex((l) => l.includes(label))
    expect(at).toBeGreaterThan(0)
    expect(lines[at - 1]).toBe('='.repeat(40))
    expect(lines.filter((l) => l.toUpperCase().includes(label))).toHaveLength(1)
    // Before the terms block, not buried inside it.
    expect(at).toBeLessThan(lines.findIndex((l) => l.includes(en.pos.print.layaway.terms.toUpperCase())))

    const html = saleReceiptHtml(lay, 'letter')
    expect(html.match(/class="balance"/g)).toHaveLength(1)
    expect(html).toContain(`<div class="balance"><span>${escapeHtml(en.pos.print.layaway.balance)}`)
    expect(html.indexOf('class="balance"')).toBeLessThan(html.indexOf(escapeHtml(en.pos.print.layaway.terms) + ' '))
  })

  it('says refunded in full when there is no cancellation fee', () => {
    const noFee = thermalReceiptLines(doc({ sale_kind: 'layaway', layaway: { ...LAYAWAY, cancellation_fee_pct: 0 } }))
      .join(' ')
      .replace(/\s+/g, ' ')
    expect(noFee).toContain(en.pos.print.layaway.policyNoFee)
  })

  it('letter page carries the same terms', () => {
    const html = saleReceiptHtml(lay, 'letter')
    expect(html).toContain('L-000001')
    expect(html).toContain(escapeHtml(es.pos.print.layaway.terms))
  })

  it('has the customer sign that they understand the terms, both languages', () => {
    const flat = text.replace(/\s+/g, ' ')
    expect(flat).toContain(en.pos.print.layaway.acknowledge)
    expect(flat).toContain(es.pos.print.layaway.acknowledge)
    expect(text).toContain('Customer signature / Firma del cliente')
    expect(lines).toContain('_'.repeat(40))
    const html = saleReceiptHtml(lay, 'letter')
    expect(html).toContain('<div class="sign-line">')
    expect(html).toContain(escapeHtml(es.pos.print.layaway.acknowledge))
  })

  it('a plain sale has no signature block', () => {
    expect(thermalReceiptLines(doc()).join('\n')).not.toContain(en.pos.print.layaway.signature)
    expect(saleReceiptHtml(doc(), 'letter')).not.toContain('<div class="sign-line">')
  })
})

describe('saleReceiptHtml', () => {
  it('escapes shop-entered text', () => {
    const html = saleReceiptHtml(doc({ notes: '<script>alert(1)</script>' }), 'letter')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain(escapeHtml('<script>alert(1)</script>'))
  })

  it('thermal is a monospace pre block; letter is a letter page', () => {
    const thermal = saleReceiptHtml(doc(), 'thermal')
    expect(thermal).toContain('<pre>')
    expect(thermal).toContain('monospace')
    const letter = saleReceiptHtml(doc(), 'letter')
    expect(letter).toContain('size:letter')
    expect(letter).toContain('S-000007')
  })
})

describe('a tip added on the card reader', () => {
  const tipped = doc({
    payments: [
      { amount: 1290, method: 'card', occurred_at: '2026-11-21T18:05:00Z', card_last4: '4242', card_brand: 'visa', tip: 20 },
    ],
  })

  it('is printed under the payment it rode on, in both languages', () => {
    const lines = thermalReceiptLines(tipped)
    const at = lines.findIndex((l) => l.startsWith('Tip / Propina'))
    expect(at).toBeGreaterThan(0)
    expect(lines[at]).toContain('$20.00')
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40)
    const html = saleReceiptHtml(tipped, 'letter')
    expect(html).toContain('Propina')
    expect(html).toContain('$20.00')
  })

  it('is not part of what was paid toward the sale', () => {
    const text = thermalReceiptLines(tipped).join(' | ')
    // Paid stays the sale amount; nothing is owed.
    expect(text).toContain('$1,290.00')
    expect(text.toUpperCase()).not.toContain(en.pos.print.totals.balance.toUpperCase())
  })

  it('prints no tip line when there is none', () => {
    expect(thermalReceiptLines(doc()).join(' | ')).not.toContain('Propina')
  })
})
