import { describe, expect, it } from 'vitest'
import { checkoutSchema } from './validation'
import { storeSettingsSchema, toSettingsPatch } from './settings'
import { orderError } from './orders-errors'

const ID = '11111111-1111-4111-8111-111111111111'

describe('checkoutSchema', () => {
  it('accepts a pickup order and normalizes contact fields', () => {
    const r = checkoutSchema.parse({ itemIds: [ID], name: ' Ana ', email: ' Ana@Example.COM ', fulfillment: 'pickup' })
    expect(r).toMatchObject({ name: 'Ana', email: 'ana@example.com', phone: null, language: 'en' })
  })
  it('requires a full US address to ship', () => {
    expect(checkoutSchema.safeParse({ itemIds: [ID], name: 'A', email: 'a@b.co', fulfillment: 'ship' }).success).toBe(false)
    const ok = checkoutSchema.safeParse({
      itemIds: [ID], name: 'A', email: 'a@b.co', fulfillment: 'ship',
      address: { line1: '1 Main', city: 'Tampa', state: 'fl', postal: '33602' },
    })
    expect(ok.success && ok.data.address?.state).toBe('FL')
    expect(checkoutSchema.safeParse({
      itemIds: [ID], name: 'A', email: 'a@b.co', fulfillment: 'ship',
      address: { line1: '1 Main', city: 'Tampa', state: 'Florida', postal: '33602' },
    }).success).toBe(false)
  })
  it('caps an order at 10 pieces and rejects bad ids', () => {
    expect(checkoutSchema.safeParse({ itemIds: Array(11).fill(ID), name: 'A', email: 'a@b.co', fulfillment: 'pickup' }).success).toBe(false)
    expect(checkoutSchema.safeParse({ itemIds: ['x'], name: 'A', email: 'a@b.co', fulfillment: 'pickup' }).success).toBe(false)
  })
})

describe('storeSettingsSchema', () => {
  const base = {
    online_checkout_enabled: true,
    tax_rate_pct: '7.5',
    online_pickup_enabled: true,
    online_ship_enabled: false,
    ship_flat_rate: '0',
    ship_free_over: '',
    ship_signature_over: '',
    online_order_max: '2500',
    online_reservation_minutes: '30',
    store_return_policy_en: '',
    store_return_policy_es: '',
    store_shipping_policy_en: '',
    store_shipping_policy_es: '',
    store_tagline_en: ' Fine jewelry ',
    store_tagline_es: '',
    store_accent_color: '',
  }
  it('converts the percent to a fraction and blanks to null', () => {
    const patch = toSettingsPatch(storeSettingsSchema.parse(base))
    expect(patch.default_tax_rate).toBe(0.075)
    expect(patch.ship_free_over).toBeNull()
    expect(patch.store_tagline_en).toBe('Fine jewelry')
    expect(patch.store_accent_color).toBeNull()
    expect('tax_rate_pct' in patch).toBe(false)
  })
  it('refuses a store with no way to deliver, a short hold and a bad color', () => {
    expect(storeSettingsSchema.safeParse({ ...base, online_pickup_enabled: false }).success).toBe(false)
    expect(storeSettingsSchema.safeParse({ ...base, online_reservation_minutes: '10' }).success).toBe(false)
    expect(storeSettingsSchema.safeParse({ ...base, store_accent_color: 'red' }).success).toBe(false)
  })
})

describe('orderError', () => {
  it('maps database and Stripe messages to shopper errors', () => {
    expect(orderError('ERROR: P0001: item_unavailable')).toBe('item_unavailable')
    expect(orderError('tenant_stripe_not_connected')).toBe('stripe_not_connected')
    expect(orderError('boom')).toBe('generic')
  })
})
