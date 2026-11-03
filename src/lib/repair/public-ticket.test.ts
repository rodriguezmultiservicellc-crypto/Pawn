import { describe, expect, it } from 'vitest'
import {
  PUBLIC_TICKET_FORBIDDEN_KEYS,
  shapePublicTicket,
} from './public-ticket'

const RPC_DOC = {
  ticket_number: 'RT-000042',
  service_type: 'custom',
  status: 'in_progress',
  item_description: '14k yellow gold nameplate "Maria"',
  promised_date: '2026-11-20',
  quote_amount: '450.0000',
  deposit_amount: '100.0000',
  paid_amount: '50.0000',
  balance_due: '300.0000',
  completed_at: null,
  picked_up_at: null,
  created_at: '2026-11-01T15:00:00Z',
  stage: { id: 's4', name_en: 'Casting', name_es: 'Fundición', percent: 40, sort_order: 40 },
  stages: [
    { id: 's4', name_en: 'Casting', name_es: 'Fundición', percent: 40, sort_order: 40 },
    { id: 's1', name_en: 'Design', name_es: 'Diseño', percent: 10, sort_order: 10 },
  ],
  photo_path: 'tenant/ticket/reference/x.jpg',
  language: 'es',
  shop: { name: "Eddy's Jewelers", logo_url: null, phone: '(813) 555-0100', public_slug: null },
}

describe('shapePublicTicket', () => {
  it('rebuilds the customer-safe document and coerces numerics', () => {
    const doc = shapePublicTicket(RPC_DOC)!
    expect(doc.ticket_number).toBe('RT-000042')
    expect(doc.quote_amount).toBe(450)
    expect(doc.paid_total).toBe(150)
    expect(doc.balance_due).toBe(300)
    expect(doc.language).toBe('es')
    expect(doc.stage?.name_es).toBe('Fundición')
    expect(doc.stages.map((s) => s.id)).toEqual(['s1', 's4'])
    expect(doc.shop.phone).toBe('(813) 555-0100')
  })

  it('never carries a forbidden key, even if the RPC starts returning one', () => {
    const leaky = {
      ...RPC_DOC,
      id: 'ticket-uuid',
      tenant_id: 'tenant-uuid',
      customer_id: 'customer-uuid',
      customer: { first_name: 'Guadalupe', last_name: 'Lopez', phone: '555-0199' },
      customer_phone: '555-0199',
      customer_email: 'maria@example.com',
      notes_internal: 'customer is difficult',
      description: 'internal work description',
      assigned_to: 'tech-uuid',
      pickup_signature_path: 'sig.png',
      public_token: 'abc',
      shop: { ...RPC_DOC.shop, address: '123 Main St', email: 'shop@x.com' },
    }
    const doc = shapePublicTicket(leaky)!
    const json = JSON.stringify(doc)
    for (const key of PUBLIC_TICKET_FORBIDDEN_KEYS) {
      expect(Object.keys(doc)).not.toContain(key)
      // Nested objects may legitimately carry an `id` (a stage id is not a
      // secret); every other forbidden key must be absent at any depth.
      if (key !== 'id') expect(json).not.toContain(`"${key}":`)
    }
    expect(json).not.toContain('ticket-uuid')
    // The piece's description may legitimately mention a name ("Maria"
    // nameplate); the CUSTOMER's name must not appear anywhere.
    expect(json).not.toContain('Guadalupe')
    expect(json).not.toContain('Lopez')
    expect(json).not.toContain('555-0199')
    expect(json).not.toContain('maria@example.com')
    expect(json).not.toContain('difficult')
    // The STORE phone is public by design; the customer's never is.
    expect(doc.shop.phone).toBe('(813) 555-0100')
  })

  it('returns null for garbage or a missing ticket', () => {
    expect(shapePublicTicket(null)).toBeNull()
    expect(shapePublicTicket('string')).toBeNull()
    expect(shapePublicTicket({ ticket_number: 'RT-1' })).toBeNull()
  })

  it('defaults language to en and drops a malformed stage', () => {
    const doc = shapePublicTicket({
      ...RPC_DOC,
      language: 'fr',
      stage: { id: 'x' },
      stages: [{ nope: true }],
    })!
    expect(doc.language).toBe('en')
    expect(doc.stage).toBeNull()
    expect(doc.stages).toEqual([])
  })
})
