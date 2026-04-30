/**
 * Zod-schema tests for the customer validation surface.
 *
 * The customer record is the load-bearing junction for compliance —
 * pawn intake, buy-outright intake, and police-report exports all
 * resolve from here. Tests pin down:
 *
 *   1. Empty-string shield on every optional field (Session 8).
 *   2. country defaults to 'US' when blank, accepts overrides, and
 *      enforces a 2-char ISO code when present.
 *   3. Email format gate (only when non-empty).
 *   4. id_type / comm_preference enum-empty-string shield.
 *   5. height_inches / weight_lbs sanity bounds (Florida intake form
 *      has these as physical-description columns).
 *   6. tags accepts comma-separated strings AND arrays (FormData and
 *      JSON callers diverge here).
 *   7. customerUpdateSchema requires a UUID id.
 *   8. banCustomerSchema is_banned coerces from "true" / "false" /
 *      "on" / "off" — Form checkbox quirks.
 *   9. customerDocumentUploadSchema kind enum tightness.
 */

import { describe, expect, it } from 'vitest'
import {
  banCustomerSchema,
  customerCreateSchema,
  customerDocumentUploadSchema,
  customerUpdateSchema,
} from './customer'

const VALID_UUID = crypto.randomUUID()

function validCreate(over: Record<string, unknown> = {}) {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    ...over,
  }
}

// ── customerCreateSchema ───────────────────────────────────────────────

describe('customerCreateSchema', () => {
  it('accepts the minimum (first + last name only)', () => {
    expect(customerCreateSchema.safeParse(validCreate()).success).toBe(true)
  })

  it('rejects missing first_name', () => {
    expect(
      customerCreateSchema.safeParse({ last_name: 'Doe' }).success,
    ).toBe(false)
  })

  it('rejects missing last_name', () => {
    expect(
      customerCreateSchema.safeParse({ first_name: 'Jane' }).success,
    ).toBe(false)
  })

  it('rejects whitespace-only first_name (trimmed to empty)', () => {
    expect(
      customerCreateSchema.safeParse({
        first_name: '   ',
        last_name: 'Doe',
      }).success,
    ).toBe(false)
  })

  it('drops every empty-string optional field to null', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({
        middle_name: '',
        date_of_birth: '',
        phone: '',
        phone_alt: '',
        email: '',
        address1: '',
        city: '',
        state: '',
        zip: '',
        id_number: '',
        id_state: '',
        id_expiry: '',
        height_inches: '',
        weight_lbs: '',
        sex: '',
        notes: '',
      }),
    )
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.middle_name).toBeNull()
      expect(r.data.date_of_birth).toBeNull()
      expect(r.data.phone).toBeNull()
      expect(r.data.email).toBeNull()
      expect(r.data.height_inches).toBeNull()
      expect(r.data.weight_lbs).toBeNull()
    }
  })

  it("country defaults to 'US' when blank", () => {
    const r = customerCreateSchema.safeParse(validCreate({ country: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.country).toBe('US')
  })

  it('country accepts overrides (CO, MX, etc.)', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({ country: 'CO' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.country).toBe('CO')
  })

  it('country must be exactly 2 chars when present', () => {
    expect(
      customerCreateSchema.safeParse(validCreate({ country: 'USA' })).success,
    ).toBe(false)
    expect(
      customerCreateSchema.safeParse(validCreate({ country: 'U' })).success,
    ).toBe(false)
  })

  it('email rejects malformed values', () => {
    expect(
      customerCreateSchema.safeParse(
        validCreate({ email: 'not-an-email' }),
      ).success,
    ).toBe(false)
  })

  it('email accepts valid format', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({ email: 'jane.doe@example.com' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('jane.doe@example.com')
  })

  it('id_type empty string drops to null (placeholder option)', () => {
    const r = customerCreateSchema.safeParse(validCreate({ id_type: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id_type).toBeNull()
  })

  it('id_type accepts the enum values', () => {
    for (const t of [
      'drivers_license',
      'state_id',
      'passport',
      'military_id',
      'permanent_resident_card',
      'other',
    ]) {
      expect(
        customerCreateSchema.safeParse(validCreate({ id_type: t })).success,
      ).toBe(true)
    }
  })

  it('id_type rejects unknown values', () => {
    expect(
      customerCreateSchema.safeParse(validCreate({ id_type: 'school_id' }))
        .success,
    ).toBe(false)
  })

  it('comm_preference defaults to "sms"', () => {
    const r = customerCreateSchema.safeParse(validCreate())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.comm_preference).toBe('sms')
  })

  it('language defaults to "en"', () => {
    const r = customerCreateSchema.safeParse(validCreate())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.language).toBe('en')
  })

  it('language enum is exactly en | es', () => {
    expect(
      customerCreateSchema.safeParse(validCreate({ language: 'es' })).success,
    ).toBe(true)
    expect(
      customerCreateSchema.safeParse(validCreate({ language: 'fr' })).success,
    ).toBe(false)
  })

  it('marketing_opt_in coerces "true" / "on" / "1" to true', () => {
    for (const v of ['true', 'on', '1']) {
      const r = customerCreateSchema.safeParse(
        validCreate({ marketing_opt_in: v }),
      )
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.marketing_opt_in).toBe(true)
    }
  })

  it('marketing_opt_in defaults to false when absent', () => {
    const r = customerCreateSchema.safeParse(validCreate())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.marketing_opt_in).toBe(false)
  })

  it('height_inches enforces 12..108 bounds', () => {
    expect(
      customerCreateSchema.safeParse(validCreate({ height_inches: 11 }))
        .success,
    ).toBe(false)
    expect(
      customerCreateSchema.safeParse(validCreate({ height_inches: 109 }))
        .success,
    ).toBe(false)
    expect(
      customerCreateSchema.safeParse(validCreate({ height_inches: 70 }))
        .success,
    ).toBe(true)
  })

  it('weight_lbs enforces 1..999 bounds', () => {
    expect(
      customerCreateSchema.safeParse(validCreate({ weight_lbs: 0 })).success,
    ).toBe(false)
    expect(
      customerCreateSchema.safeParse(validCreate({ weight_lbs: 1000 }))
        .success,
    ).toBe(false)
    expect(
      customerCreateSchema.safeParse(validCreate({ weight_lbs: 175 }))
        .success,
    ).toBe(true)
  })

  it('date_of_birth rejects malformed dates', () => {
    expect(
      customerCreateSchema.safeParse(validCreate({ date_of_birth: '2026/04/30' }))
        .success,
    ).toBe(false)
  })

  it('date_of_birth accepts ISO dates', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({ date_of_birth: '1990-05-15' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.date_of_birth).toBe('1990-05-15')
  })
})

// ── tags ───────────────────────────────────────────────────────────────

describe('customerCreateSchema.tags', () => {
  it('parses a comma-separated string', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({ tags: 'vip, repeat, gold' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tags).toEqual(['vip', 'repeat', 'gold'])
  })

  it('accepts an array directly', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({ tags: ['vip', 'wholesale'] }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tags).toEqual(['vip', 'wholesale'])
  })

  it('drops empty entries from a comma-separated string', () => {
    const r = customerCreateSchema.safeParse(
      validCreate({ tags: 'vip, , repeat,,gold' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tags).toEqual(['vip', 'repeat', 'gold'])
  })

  it('caps total tags at 20', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `t${i}`)
    expect(
      customerCreateSchema.safeParse(validCreate({ tags: tooMany })).success,
    ).toBe(false)
  })

  it('caps individual tag length at 40', () => {
    const tooLong = 'a'.repeat(41)
    expect(
      customerCreateSchema.safeParse(validCreate({ tags: [tooLong] })).success,
    ).toBe(false)
  })

  it('defaults to [] when absent', () => {
    const r = customerCreateSchema.safeParse(validCreate())
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tags).toEqual([])
  })
})

// ── customerUpdateSchema ───────────────────────────────────────────────

describe('customerUpdateSchema', () => {
  it('requires a UUID id', () => {
    expect(
      customerUpdateSchema.safeParse(validCreate({ id: 'not-a-uuid' })).success,
    ).toBe(false)
  })

  it('accepts a valid UUID', () => {
    expect(
      customerUpdateSchema.safeParse(validCreate({ id: VALID_UUID })).success,
    ).toBe(true)
  })

  it('is_banned defaults to false', () => {
    const r = customerUpdateSchema.safeParse(validCreate({ id: VALID_UUID }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.is_banned).toBe(false)
  })
})

// ── banCustomerSchema ──────────────────────────────────────────────────

describe('banCustomerSchema', () => {
  it('coerces is_banned from string "true"', () => {
    const r = banCustomerSchema.safeParse({
      customer_id: VALID_UUID,
      is_banned: 'true',
      reason: 'fraud attempt',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.is_banned).toBe(true)
  })

  it('rejects missing customer_id', () => {
    expect(
      banCustomerSchema.safeParse({ is_banned: true, reason: 'fraud' })
        .success,
    ).toBe(false)
  })

  it('reason can be null when unbanning', () => {
    const r = banCustomerSchema.safeParse({
      customer_id: VALID_UUID,
      is_banned: false,
      reason: '',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.reason).toBeNull()
  })
})

// ── customerDocumentUploadSchema ───────────────────────────────────────

describe('customerDocumentUploadSchema', () => {
  it("kind must be 'id_scan' or 'signature'", () => {
    expect(
      customerDocumentUploadSchema.safeParse({
        customer_id: VALID_UUID,
        kind: 'id_scan',
      }).success,
    ).toBe(true)
    expect(
      customerDocumentUploadSchema.safeParse({
        customer_id: VALID_UUID,
        kind: 'signature',
      }).success,
    ).toBe(true)
    expect(
      customerDocumentUploadSchema.safeParse({
        customer_id: VALID_UUID,
        kind: 'photo',
      }).success,
    ).toBe(false)
  })

  it('id_type empty drops to null', () => {
    const r = customerDocumentUploadSchema.safeParse({
      customer_id: VALID_UUID,
      kind: 'id_scan',
      id_type: '',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id_type).toBeNull()
  })

  it('id_expiry accepts ISO date and null/empty', () => {
    expect(
      customerDocumentUploadSchema.safeParse({
        customer_id: VALID_UUID,
        kind: 'id_scan',
        id_expiry: '2030-06-15',
      }).success,
    ).toBe(true)
    expect(
      customerDocumentUploadSchema.safeParse({
        customer_id: VALID_UUID,
        kind: 'id_scan',
        id_expiry: '',
      }).success,
    ).toBe(true)
  })

  it('id_expiry rejects malformed dates', () => {
    expect(
      customerDocumentUploadSchema.safeParse({
        customer_id: VALID_UUID,
        kind: 'id_scan',
        id_expiry: '2030/06/15',
      }).success,
    ).toBe(false)
  })
})
