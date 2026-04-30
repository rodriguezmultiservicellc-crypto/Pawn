/**
 * Zod-schema tests for the pawn-loan validation surface.
 *
 * These schemas gate every financial write on the loan side — intake,
 * payment splits, extensions, forfeit, void. A regression here either
 * lets a malformed loan land in the DB (invalid principal, runaway
 * interest rate, missing collateral) or rejects a legitimate intake
 * with cryptic error messages. The patterns we pin down:
 *
 *   1. Empty-string shield (Session 8): every optional field that
 *      arrives as "" from FormData survives validation as null, not
 *      a hard min(1) rejection.
 *   2. Empty enums (placeholder "—") on metal_type drop to null.
 *   3. Required positive decimals reject 0 (principal) but allow 0
 *      where the schema says nonnegative (interest paid, fees).
 *   4. interest_rate_monthly hard cap at 0.25 (legal interest cap;
 *      the Florida default rates table reads through this).
 *   5. term_days bounds (1..180) — an extension cannot zero-out the
 *      term and cannot exceed 6 months.
 *   6. Payment split must sum to amount within a $0.0001 tolerance.
 *   7. issue_date defaults to today when blank — no timezone drift
 *      (the helper uses UTC).
 *   8. Collateral array must have at least one item, max 50, and
 *      every item must validate.
 *   9. Void requires reason of at least 10 chars (the reason is the
 *      audit trail; empty / "ok" reasons get rejected).
 */

import { describe, expect, it } from 'vitest'
import {
  collateralItemSchema,
  collateralItemsArraySchema,
  loanCreateSchema,
  loanExtensionSchema,
  loanForfeitSchema,
  loanPaymentSchema,
  loanVoidSchema,
} from './loan'

// Zod 4's uuid validator requires variant bits per RFC 4122 (v1-8 in
// the version field, 8/9/a/b in the variant nibble). Generate a real
// v4 UUID at test time so the fixture stays valid as the validator
// tightens.
const VALID_UUID = crypto.randomUUID()
const VALID_DATE = '2026-04-30'

function validCollateralItem(over: Record<string, unknown> = {}) {
  return {
    description: 'Gold ring 14k',
    category: 'ring',
    metal_type: 'gold',
    karat: 14,
    weight_grams: 5.5,
    est_value: 500,
    photo_path: 't/abc/photo.jpg',
    position: 0,
    ...over,
  }
}

function validLoanCreate(over: Record<string, unknown> = {}) {
  return {
    customer_id: VALID_UUID,
    principal: 200,
    interest_rate_monthly: 0.1,
    term_days: 30,
    issue_date: VALID_DATE,
    collateral: [validCollateralItem()],
    ...over,
  }
}

// ── collateralItemSchema ──────────────────────────────────────────────

describe('collateralItemSchema', () => {
  it('accepts a fully-populated item', () => {
    expect(collateralItemSchema.safeParse(validCollateralItem()).success).toBe(
      true,
    )
  })

  it('rejects a too-short description', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ description: 'a' }),
    )
    expect(r.success).toBe(false)
  })

  it('drops empty-string metal_type to null (placeholder option)', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ metal_type: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.metal_type).toBeNull()
  })

  it('drops empty-string karat / weight_grams to null', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ karat: '', weight_grams: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.karat).toBeNull()
      expect(r.data.weight_grams).toBeNull()
    }
  })

  it('coerces numeric strings (FormData arrives as strings)', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ karat: '18', weight_grams: '7.25', est_value: '300' }),
    )
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.karat).toBe(18)
      expect(r.data.weight_grams).toBe(7.25)
      expect(r.data.est_value).toBe(300)
    }
  })

  it('defaults est_value to 0 when blank', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ est_value: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.est_value).toBe(0)
  })

  it('rejects karat above 24', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ karat: 25 }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects negative weight_grams', () => {
    const r = collateralItemSchema.safeParse(
      validCollateralItem({ weight_grams: -1 }),
    )
    expect(r.success).toBe(false)
  })
})

// ── collateralItemsArraySchema ─────────────────────────────────────────

describe('collateralItemsArraySchema', () => {
  it('rejects empty array', () => {
    const r = collateralItemsArraySchema.safeParse([])
    expect(r.success).toBe(false)
  })

  it('rejects more than 50 items', () => {
    const items = Array.from({ length: 51 }, () => validCollateralItem())
    const r = collateralItemsArraySchema.safeParse(items)
    expect(r.success).toBe(false)
  })

  it('accepts 1..50 items', () => {
    expect(
      collateralItemsArraySchema.safeParse([validCollateralItem()]).success,
    ).toBe(true)
    expect(
      collateralItemsArraySchema.safeParse(
        Array.from({ length: 50 }, () => validCollateralItem()),
      ).success,
    ).toBe(true)
  })
})

// ── loanCreateSchema ───────────────────────────────────────────────────

describe('loanCreateSchema', () => {
  it('accepts a valid intake', () => {
    expect(loanCreateSchema.safeParse(validLoanCreate()).success).toBe(true)
  })

  it('rejects principal of 0 (must be positive)', () => {
    const r = loanCreateSchema.safeParse(validLoanCreate({ principal: 0 }))
    expect(r.success).toBe(false)
  })

  it('rejects negative principal', () => {
    const r = loanCreateSchema.safeParse(validLoanCreate({ principal: -100 }))
    expect(r.success).toBe(false)
  })

  it('caps interest_rate_monthly at 0.25', () => {
    expect(
      loanCreateSchema.safeParse(
        validLoanCreate({ interest_rate_monthly: 0.25 }),
      ).success,
    ).toBe(true)
    expect(
      loanCreateSchema.safeParse(
        validLoanCreate({ interest_rate_monthly: 0.26 }),
      ).success,
    ).toBe(false)
  })

  it('allows zero interest', () => {
    expect(
      loanCreateSchema.safeParse(
        validLoanCreate({ interest_rate_monthly: 0 }),
      ).success,
    ).toBe(true)
  })

  it('term_days must be 1..180', () => {
    expect(
      loanCreateSchema.safeParse(validLoanCreate({ term_days: 0 })).success,
    ).toBe(false)
    expect(
      loanCreateSchema.safeParse(validLoanCreate({ term_days: 181 })).success,
    ).toBe(false)
    expect(
      loanCreateSchema.safeParse(validLoanCreate({ term_days: 180 })).success,
    ).toBe(true)
    expect(
      loanCreateSchema.safeParse(validLoanCreate({ term_days: 1 })).success,
    ).toBe(true)
  })

  it('defaults issue_date to today when blank', () => {
    const today = new Date().toISOString().slice(0, 10)
    const r = loanCreateSchema.safeParse(
      validLoanCreate({ issue_date: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.issue_date).toBe(today)
  })

  it('rejects malformed issue_date', () => {
    const r = loanCreateSchema.safeParse(
      validLoanCreate({ issue_date: '04/30/2026' }),
    )
    expect(r.success).toBe(false)
  })

  it('drops empty due_date to null', () => {
    const r = loanCreateSchema.safeParse(validLoanCreate({ due_date: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.due_date).toBeNull()
  })

  it('rejects malformed customer_id (not a UUID)', () => {
    const r = loanCreateSchema.safeParse(
      validLoanCreate({ customer_id: 'abc' }),
    )
    expect(r.success).toBe(false)
  })

  it('drops empty min_monthly_charge to null (custom rate selection)', () => {
    const r = loanCreateSchema.safeParse(
      validLoanCreate({ min_monthly_charge: '' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.min_monthly_charge).toBeNull()
  })
})

// ── loanPaymentSchema (split sum guard) ────────────────────────────────

describe('loanPaymentSchema', () => {
  function payment(over: Record<string, unknown> = {}) {
    return {
      loan_id: VALID_UUID,
      amount: 100,
      payment_method: 'cash',
      principal_paid: 50,
      interest_paid: 50,
      fees_paid: 0,
      ...over,
    }
  }

  it('accepts a valid payment with matching split', () => {
    expect(loanPaymentSchema.safeParse(payment()).success).toBe(true)
  })

  it('rejects a payment whose split does not sum to amount', () => {
    const r = loanPaymentSchema.safeParse(
      payment({ principal_paid: 50, interest_paid: 30, fees_paid: 0 }),
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path.join('.') === 'amount')
      expect(msg?.message).toBe('split_mismatch')
    }
  })

  it('tolerates floating-point drift up to $0.0001', () => {
    // 33.33 + 33.33 + 33.34 = 100.00 exactly
    expect(
      loanPaymentSchema.safeParse(
        payment({
          amount: 100,
          principal_paid: 33.33,
          interest_paid: 33.33,
          fees_paid: 33.34,
        }),
      ).success,
    ).toBe(true)
  })

  it('rejects a payment of 0 (must be positive)', () => {
    const r = loanPaymentSchema.safeParse(
      payment({ amount: 0, principal_paid: 0, interest_paid: 0 }),
    )
    expect(r.success).toBe(false)
  })

  it('defaults split fields to 0 when blank', () => {
    // amount 100, no splits provided — defaults zero-fill the splits,
    // which then fails the sum guard with a useful error.
    const r = loanPaymentSchema.safeParse({
      loan_id: VALID_UUID,
      amount: 100,
    })
    expect(r.success).toBe(false)
  })
})

// ── loanExtensionSchema ────────────────────────────────────────────────

describe('loanExtensionSchema', () => {
  function ext(over: Record<string, unknown> = {}) {
    return {
      loan_id: VALID_UUID,
      new_term_days: 30,
      interest_collected_now: 20,
      ...over,
    }
  }

  it('accepts a valid extension', () => {
    expect(loanExtensionSchema.safeParse(ext()).success).toBe(true)
  })

  it('rejects new_term_days of 0', () => {
    expect(loanExtensionSchema.safeParse(ext({ new_term_days: 0 })).success).toBe(
      false,
    )
  })

  it('rejects new_term_days above 180', () => {
    expect(
      loanExtensionSchema.safeParse(ext({ new_term_days: 181 })).success,
    ).toBe(false)
  })

  it('defaults interest_collected_now to 0', () => {
    const r = loanExtensionSchema.safeParse({
      loan_id: VALID_UUID,
      new_term_days: 30,
      interest_collected_now: '',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.interest_collected_now).toBe(0)
  })
})

// ── loanForfeitSchema ──────────────────────────────────────────────────

describe('loanForfeitSchema', () => {
  it('accepts a forfeit with no notes', () => {
    expect(
      loanForfeitSchema.safeParse({ loan_id: VALID_UUID, notes: '' }).success,
    ).toBe(true)
  })

  it('rejects a missing loan_id', () => {
    expect(loanForfeitSchema.safeParse({ notes: 'because' }).success).toBe(
      false,
    )
  })
})

// ── loanVoidSchema ─────────────────────────────────────────────────────

describe('loanVoidSchema', () => {
  it('accepts a 10+ char reason', () => {
    expect(
      loanVoidSchema.safeParse({
        loan_id: VALID_UUID,
        reason: 'duplicate intake — closed in error',
      }).success,
    ).toBe(true)
  })

  it('rejects a too-short reason', () => {
    expect(
      loanVoidSchema.safeParse({ loan_id: VALID_UUID, reason: 'oops' }).success,
    ).toBe(false)
  })

  it('rejects an empty reason', () => {
    expect(
      loanVoidSchema.safeParse({ loan_id: VALID_UUID, reason: '' }).success,
    ).toBe(false)
  })
})
