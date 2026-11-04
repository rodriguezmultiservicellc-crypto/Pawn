import { describe, expect, it } from 'vitest'
import { PUBLIC_QUOTE_FORBIDDEN_KEYS, shapePublicQuote } from './public-quote'

const RPC_DOC = {
  quote_number: 'CQ-000007',
  status: 'sent',
  category: 'nameplate',
  description: '14k yellow gold nameplate "Maria", 1.5in',
  size: '1.5 in',
  price_total: '640.0000',
  deposit_pct: '0.5000',
  deposit_amount: '320.0000',
  balance_due: '320.0000',
  expires_on: '2026-11-17',
  spot_priced_at: '2026-11-03T21:02:27Z',
  spot_price_per_gram: '73.5536',
  spot_metal_label: 'Gold 14k',
  created_at: '2026-11-03T21:10:00Z',
  accepted_at: null,
  lines: [
    { kind: 'metal', label: 'Gold 14k × 6.2 g', quantity: 6.2, price_total: 912.06 },
    { kind: 'labor', label: 'Bench labor', quantity: 2, price_total: 150 },
  ],
  photo_path: 'tenant/quotes/q/reference/x.jpg',
  language: 'es',
  shop: { name: "Eddy's Jewelers", logo_url: null, phone: '(813) 555-0100', public_slug: 'eddys' },
}

describe('shapePublicQuote', () => {
  it('rebuilds the customer-safe document and coerces numerics', () => {
    const doc = shapePublicQuote(RPC_DOC)!
    expect(doc.quote_number).toBe('CQ-000007')
    expect(doc.price_total).toBe(640)
    expect(doc.deposit_amount).toBe(320)
    expect(doc.spot_price_per_gram).toBe(73.5536)
    expect(doc.lines).toHaveLength(2)
    expect(doc.lines[0]).toEqual({ kind: 'metal', label: 'Gold 14k × 6.2 g', quantity: 6.2, price_total: 912.06 })
    expect(doc.language).toBe('es')
    expect(doc.shop.public_slug).toBe('eddys')
  })

  it('never carries a cost, a margin or the customer, even if the RPC leaks them', () => {
    const leaky = {
      ...RPC_DOC,
      id: 'quote-uuid',
      tenant_id: 'tenant-uuid',
      customer_id: 'customer-uuid',
      customer: { first_name: 'Guadalupe', last_name: 'Lopez', phone: '555-0199' },
      margin_pct: 0.5,
      cost_total: 320,
      notes_internal: 'lowball if they push back',
      public_token: 'abc',
      lines: [
        { kind: 'metal', label: 'Gold 14k × 6.2 g', quantity: 6.2, price_total: 912.06, unit_cost: 73.55, cost_total: 456.03, inventory_item_id: 'inv-1', price_locked: false },
      ],
    }
    const doc = shapePublicQuote(leaky)!
    const json = JSON.stringify(doc)
    for (const key of PUBLIC_QUOTE_FORBIDDEN_KEYS) {
      expect(Object.keys(doc)).not.toContain(key)
      if (key !== 'id') expect(json).not.toContain(`"${key}":`)
    }
    expect(json).not.toContain('456.03')
    expect(json).not.toContain('Guadalupe')
    expect(json).not.toContain('lowball')
  })

  it('returns null for garbage, a missing price, or an unknown status', () => {
    expect(shapePublicQuote(null)).toBeNull()
    expect(shapePublicQuote({ ...RPC_DOC, price_total: null })).toBeNull()
    expect(shapePublicQuote({ ...RPC_DOC, status: 'voided' })).toBeNull()
  })

  it('drops malformed lines and defaults language to en', () => {
    const doc = shapePublicQuote({ ...RPC_DOC, language: 'fr', lines: [{ nope: true }, { kind: 'bogus', label: 'x', quantity: 1, price_total: 1 }] })!
    expect(doc.lines).toEqual([])
    expect(doc.language).toBe('en')
  })
})
