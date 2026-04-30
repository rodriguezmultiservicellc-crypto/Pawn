/**
 * Zod-schema tests for the buy-outright validation surface.
 *
 * Buy-outright (gold buying) is regulated — every transaction emits a
 * compliance_log row, kicks off a hold-period until it can be sold,
 * and back-references to a customer record. Validation gates the
 * intake; a regression here either lets a malformed buy land in
 * compliance_log (bad police report data) or rejects a legitimate
 * intake.
 *
 * Tests pin down:
 *
 *   1. payout is REQUIRED (no zero-dollar / "free" buys — that path is
 *      the abandoned-repair conversion, not buy-outright).
 *   2. metal empty-string drops to null (placeholder option pattern).
 *   3. category defaults to 'other' so a quick-intake flow doesn't
 *      reject when the operator hasn't picked a category yet.
 *   4. Items array bounds: 1..20.
 *   5. payment_method defaults to 'cash'.
 *   6. customer_id must be a valid UUID.
 */

import { describe, expect, it } from 'vitest'
import { buyItemSchema, buyOutrightSchema } from './buy-outright'

const VALID_UUID = crypto.randomUUID()

function validItem(over: Record<string, unknown> = {}) {
  return {
    description: '14k gold chain',
    category: 'chain',
    metal: 'gold',
    karat: '14',
    weight_grams: 12.5,
    payout: 600,
    serial_number: null,
    photo_path: null,
    position: 0,
    ...over,
  }
}

function validBuy(over: Record<string, unknown> = {}) {
  return {
    customer_id: VALID_UUID,
    payment_method: 'cash',
    items: [validItem()],
    ...over,
  }
}

// ── buyItemSchema ──────────────────────────────────────────────────────

describe('buyItemSchema', () => {
  it('accepts a fully-populated item', () => {
    expect(buyItemSchema.safeParse(validItem()).success).toBe(true)
  })

  it('rejects an empty description', () => {
    expect(
      buyItemSchema.safeParse(validItem({ description: '' })).success,
    ).toBe(false)
  })

  it('rejects a whitespace-only description', () => {
    expect(
      buyItemSchema.safeParse(validItem({ description: '   ' })).success,
    ).toBe(false)
  })

  it('drops empty metal to null (placeholder option)', () => {
    const r = buyItemSchema.safeParse(validItem({ metal: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.metal).toBeNull()
  })

  it('rejects invalid metal enum values', () => {
    expect(
      buyItemSchema.safeParse(validItem({ metal: 'plutonium' })).success,
    ).toBe(false)
  })

  it("category defaults to 'other' when absent", () => {
    const r = buyItemSchema.safeParse({
      description: 'Mystery item',
      payout: 50,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.category).toBe('other')
  })

  it('payout is required (zero-payout buys are not allowed via empty)', () => {
    // Missing payout entirely — the schema has no default for it.
    const r = buyItemSchema.safeParse({
      description: 'Mystery item',
    })
    expect(r.success).toBe(false)
  })

  it('payout coerces empty string to 0 (then nonneg passes)', () => {
    // The preprocessor maps "" → 0, which IS nonnegative. This is a
    // looser-than-ideal contract — guard rails are at the action
    // level (rejecting payout === 0). Pin the schema behavior so a
    // tightening shows up here first.
    const r = buyItemSchema.safeParse(validItem({ payout: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.payout).toBe(0)
  })

  it('payout rejects negative values', () => {
    expect(
      buyItemSchema.safeParse(validItem({ payout: -1 })).success,
    ).toBe(false)
  })

  it('weight_grams empty drops to null', () => {
    const r = buyItemSchema.safeParse(validItem({ weight_grams: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.weight_grams).toBeNull()
  })

  it('coerces weight_grams numeric strings (FormData)', () => {
    const r = buyItemSchema.safeParse(validItem({ weight_grams: '7.5' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.weight_grams).toBe(7.5)
  })

  it('serial_number empty drops to null', () => {
    const r = buyItemSchema.safeParse(validItem({ serial_number: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.serial_number).toBeNull()
  })

  it('position defaults to 0', () => {
    const r = buyItemSchema.safeParse({
      description: 'Test',
      payout: 10,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.position).toBe(0)
  })
})

// ── buyOutrightSchema ──────────────────────────────────────────────────

describe('buyOutrightSchema', () => {
  it('accepts a valid buy', () => {
    expect(buyOutrightSchema.safeParse(validBuy()).success).toBe(true)
  })

  it('rejects empty items array', () => {
    expect(
      buyOutrightSchema.safeParse(validBuy({ items: [] })).success,
    ).toBe(false)
  })

  it('rejects more than 20 items', () => {
    const items = Array.from({ length: 21 }, () => validItem())
    expect(
      buyOutrightSchema.safeParse(validBuy({ items })).success,
    ).toBe(false)
  })

  it('accepts up to 20 items', () => {
    const items = Array.from({ length: 20 }, () => validItem())
    expect(
      buyOutrightSchema.safeParse(validBuy({ items })).success,
    ).toBe(true)
  })

  it("payment_method defaults to 'cash' when absent", () => {
    const r = buyOutrightSchema.safeParse({
      customer_id: VALID_UUID,
      items: [validItem()],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.payment_method).toBe('cash')
  })

  it('payment_method accepts valid enum values', () => {
    for (const pm of ['cash', 'card', 'check', 'other']) {
      expect(
        buyOutrightSchema.safeParse(validBuy({ payment_method: pm })).success,
      ).toBe(true)
    }
  })

  it('payment_method rejects unknown values', () => {
    expect(
      buyOutrightSchema.safeParse(validBuy({ payment_method: 'bitcoin' }))
        .success,
    ).toBe(false)
  })

  it('rejects malformed customer_id', () => {
    expect(
      buyOutrightSchema.safeParse(validBuy({ customer_id: 'abc' })).success,
    ).toBe(false)
  })

  it('notes empty string drops to null', () => {
    const r = buyOutrightSchema.safeParse(validBuy({ notes: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.notes).toBeNull()
  })

  it('notes whitespace-only drops to null', () => {
    const r = buyOutrightSchema.safeParse(validBuy({ notes: '   ' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.notes).toBeNull()
  })

  it('every item in the array gets validated independently', () => {
    const r = buyOutrightSchema.safeParse(
      validBuy({
        items: [validItem(), validItem({ description: '' })],
      }),
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      // Issue path should point to items.1.description
      const offending = r.error.issues.find((i) =>
        i.path.join('.').startsWith('items.1.'),
      )
      expect(offending).toBeDefined()
    }
  })
})
