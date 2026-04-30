/**
 * Zod-schema tests for the inventory validation surface.
 *
 * Inventory is the spine — buy-outright items, pawn-forfeit conversions,
 * abandoned-repair items, and brand-new stock all land here. Validation
 * gates intake from every direction. Tests pin down:
 *
 *   1. description is required; everything else has sensible defaults
 *      or null fallbacks.
 *   2. SKU is optional — blank means "let the trigger assign one".
 *   3. category / location / status / source defaults match what the
 *      buy-outright + pawn-forfeit code paths expect.
 *   4. metal placeholder ("") drops to null; invalid metals reject.
 *   5. acquired_at defaults to today on blank.
 *   6. Stones array bounds (0..50) — the array itself is optional.
 *   7. Stone count bounds (1..999) — pavé settings can have hundreds
 *      but not thousands.
 *   8. is_total_carat coerces from FormData strings.
 */

import { describe, expect, it } from 'vitest'
import {
  inventoryItemCreateSchema,
  inventoryItemUpdateSchema,
  inventoryStoneSchema,
  inventoryStonesArraySchema,
  setPrimaryPhotoSchema,
} from './inventory'

const VALID_UUID = crypto.randomUUID()

function validItem(over: Record<string, unknown> = {}) {
  return {
    description: '14k yellow gold ring',
    source: 'bought',
    acquired_at: '2026-04-30',
    ...over,
  }
}

// ── inventoryItemCreateSchema ──────────────────────────────────────────

describe('inventoryItemCreateSchema', () => {
  it('accepts the minimum (description + source + acquired_at)', () => {
    expect(inventoryItemCreateSchema.safeParse(validItem()).success).toBe(true)
  })

  it('rejects missing description', () => {
    expect(
      inventoryItemCreateSchema.safeParse({
        source: 'bought',
        acquired_at: '2026-04-30',
      }).success,
    ).toBe(false)
  })

  it('rejects missing source (cannot infer)', () => {
    expect(
      inventoryItemCreateSchema.safeParse({
        description: 'Test',
        acquired_at: '2026-04-30',
      }).success,
    ).toBe(false)
  })

  it('source enum accepts every defined value', () => {
    for (const s of [
      'pawn_forfeit',
      'bought',
      'consigned',
      'new_stock',
      'repair_excess',
      'abandoned_repair',
    ]) {
      const r = inventoryItemCreateSchema.safeParse(
        validItem({ source: s }),
      )
      expect(r.success).toBe(true)
    }
  })

  it('source rejects unknown values', () => {
    expect(
      inventoryItemCreateSchema.safeParse(validItem({ source: 'gift' }))
        .success,
    ).toBe(false)
  })

  it("category defaults to 'other'", () => {
    const r = inventoryItemCreateSchema.safeParse(validItem())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.category).toBe('other')
  })

  it("location defaults to 'case'", () => {
    const r = inventoryItemCreateSchema.safeParse(validItem())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.location).toBe('case')
  })

  it("status defaults to 'available'", () => {
    const r = inventoryItemCreateSchema.safeParse(validItem())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.status).toBe('available')
  })

  it('SKU empty drops to null (trigger assigns one)', () => {
    const r = inventoryItemCreateSchema.safeParse(validItem({ sku: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.sku).toBeNull()
  })

  it('SKU when provided survives', () => {
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ sku: 'INV-000123' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.sku).toBe('INV-000123')
  })

  it('metal empty drops to null (placeholder option)', () => {
    const r = inventoryItemCreateSchema.safeParse(validItem({ metal: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.metal).toBeNull()
  })

  it('metal accepts valid enum values', () => {
    for (const m of [
      'gold',
      'silver',
      'platinum',
      'palladium',
      'rose_gold',
      'white_gold',
      'tungsten',
      'titanium',
      'stainless_steel',
      'mixed',
      'none',
      'other',
    ]) {
      expect(
        inventoryItemCreateSchema.safeParse(validItem({ metal: m })).success,
      ).toBe(true)
    }
  })

  it('metal rejects unknown values', () => {
    expect(
      inventoryItemCreateSchema.safeParse(validItem({ metal: 'plutonium' }))
        .success,
    ).toBe(false)
  })

  it('weight_grams empty drops to null', () => {
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ weight_grams: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.weight_grams).toBeNull()
  })

  it('weight_grams rejects negative values', () => {
    expect(
      inventoryItemCreateSchema.safeParse(validItem({ weight_grams: -1 }))
        .success,
    ).toBe(false)
  })

  it('cost_basis defaults to 0 when blank', () => {
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ cost_basis: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cost_basis).toBe(0)
  })

  it('cost_basis rejects negative values', () => {
    expect(
      inventoryItemCreateSchema.safeParse(validItem({ cost_basis: -50 }))
        .success,
    ).toBe(false)
  })

  it('acquired_at defaults to today when blank', () => {
    const today = new Date().toISOString().slice(0, 10)
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ acquired_at: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.acquired_at).toBe(today)
  })

  it('acquired_at rejects non-ISO formats', () => {
    expect(
      inventoryItemCreateSchema.safeParse(
        validItem({ acquired_at: '04/30/2026' }),
      ).success,
    ).toBe(false)
  })

  it('hold_until empty drops to null (no regulatory hold)', () => {
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ hold_until: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hold_until).toBeNull()
  })

  it('tags accepts comma-separated strings', () => {
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ tags: 'sale, vintage, men' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tags).toEqual(['sale', 'vintage', 'men'])
  })

  it('tags accepts arrays', () => {
    const r = inventoryItemCreateSchema.safeParse(
      validItem({ tags: ['sale', 'vintage'] }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tags).toEqual(['sale', 'vintage'])
  })
})

// ── inventoryItemUpdateSchema ──────────────────────────────────────────

describe('inventoryItemUpdateSchema', () => {
  it('requires a UUID id', () => {
    expect(
      inventoryItemUpdateSchema.safeParse(validItem({ id: 'not-a-uuid' }))
        .success,
    ).toBe(false)
  })

  it('accepts valid UUID', () => {
    expect(
      inventoryItemUpdateSchema.safeParse(validItem({ id: VALID_UUID }))
        .success,
    ).toBe(true)
  })

  it('sale_price empty drops to null', () => {
    const r = inventoryItemUpdateSchema.safeParse(
      validItem({ id: VALID_UUID, sale_price: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.sale_price).toBeNull()
  })

  it('sale_price coerces from string', () => {
    const r = inventoryItemUpdateSchema.safeParse(
      validItem({ id: VALID_UUID, sale_price: '1250.50' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.sale_price).toBe(1250.5)
  })
})

// ── inventoryStoneSchema ──────────────────────────────────────────────

describe('inventoryStoneSchema', () => {
  it('accepts an empty stone (defaults fill in)', () => {
    const r = inventoryStoneSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.count).toBe(1)
      expect(r.data.is_total_carat).toBe(false)
      expect(r.data.position).toBe(0)
      expect(r.data.stone_type).toBeNull()
    }
  })

  it('count must be 1..999', () => {
    expect(inventoryStoneSchema.safeParse({ count: 0 }).success).toBe(false)
    expect(inventoryStoneSchema.safeParse({ count: 1000 }).success).toBe(false)
    expect(inventoryStoneSchema.safeParse({ count: 999 }).success).toBe(true)
  })

  it('is_total_carat coerces from "true" / "on"', () => {
    for (const v of ['true', 'on', '1']) {
      const r = inventoryStoneSchema.safeParse({ is_total_carat: v })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.is_total_carat).toBe(true)
    }
  })

  it('carat empty drops to null', () => {
    const r = inventoryStoneSchema.safeParse({ carat: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.carat).toBeNull()
  })

  it('carat rejects negative values', () => {
    expect(inventoryStoneSchema.safeParse({ carat: -0.1 }).success).toBe(false)
  })

  it('id must be a valid UUID when present', () => {
    expect(
      inventoryStoneSchema.safeParse({ id: 'not-uuid' }).success,
    ).toBe(false)
    expect(
      inventoryStoneSchema.safeParse({ id: VALID_UUID }).success,
    ).toBe(true)
  })

  it('every text field empty-shields to null', () => {
    const r = inventoryStoneSchema.safeParse({
      stone_type: '',
      cut: '',
      color: '',
      clarity: '',
      certificate: '',
      notes: '',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.stone_type).toBeNull()
      expect(r.data.cut).toBeNull()
      expect(r.data.color).toBeNull()
      expect(r.data.clarity).toBeNull()
      expect(r.data.certificate).toBeNull()
      expect(r.data.notes).toBeNull()
    }
  })
})

// ── inventoryStonesArraySchema ────────────────────────────────────────

describe('inventoryStonesArraySchema', () => {
  it('accepts an empty array', () => {
    expect(inventoryStonesArraySchema.safeParse([]).success).toBe(true)
  })

  it('caps at 50 stones', () => {
    const tooMany = Array.from({ length: 51 }, () => ({}))
    expect(inventoryStonesArraySchema.safeParse(tooMany).success).toBe(false)
  })

  it('accepts up to 50 stones', () => {
    const fifty = Array.from({ length: 50 }, () => ({}))
    expect(inventoryStonesArraySchema.safeParse(fifty).success).toBe(true)
  })
})

// ── setPrimaryPhotoSchema ──────────────────────────────────────────────

describe('setPrimaryPhotoSchema', () => {
  it('requires a UUID photo_id', () => {
    expect(
      setPrimaryPhotoSchema.safeParse({ photo_id: 'abc' }).success,
    ).toBe(false)
    expect(
      setPrimaryPhotoSchema.safeParse({ photo_id: VALID_UUID }).success,
    ).toBe(true)
  })
})
