/**
 * Pure-helper tests for the SaaS billing types module.
 *
 * The pure helpers here back every plan-gate decision in the app
 * (planFeatures / planHasFeature / planLimit) plus the admin billing
 * UI's status pills and trial countdowns. Wrong answers here either
 * over-grant features (revenue leak) or under-grant them (paying
 * customer locked out). Tests pin down:
 *
 *   1. formatCents handles null, zero, large, fractional cents.
 *   2. statusTone maps every SubscriptionStatus to the right pill tone.
 *   3. isTrialing is strict — "active" with a trial_ends_at in the
 *      future is NOT trialing.
 *   4. trialDaysRemaining never returns negative numbers (rounding
 *      ceiling protects against off-by-half-day at exact midnight).
 *   5. planFeatures / planHasFeature treat the JSONB column tolerantly
 *      (null, non-array, empty, populated).
 *   6. planLimit treats the JSONB column tolerantly (null map, missing
 *      key, null value, numeric value).
 *
 * Gate I/O (checkPlanFeature / requirePlanFeature / count* in gates.ts)
 * is deferred per Session 13 vitest convention: pure-logic only, no
 * Supabase mocks.
 */

import { describe, expect, it } from 'vitest'
import {
  formatCents,
  isTrialing,
  planFeatures,
  planHasFeature,
  planLimit,
  statusTone,
  trialDaysRemaining,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type TenantSubscription,
} from './types'

// ── Test helpers ────────────────────────────────────────────────────────

function makePlan(over: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    code: 'basic',
    name: 'Basic',
    description: null,
    price_monthly_cents: 9900,
    price_yearly_cents: 99900,
    is_active: true,
    sort_order: 1,
    features: [],
    feature_limits: {},
    stripe_product_id: null,
    stripe_price_monthly_id: null,
    stripe_price_yearly_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as SubscriptionPlan
}

function makeSub(over: Partial<TenantSubscription> = {}): TenantSubscription {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    tenant_id: '00000000-0000-0000-0000-000000000020',
    plan_id: '00000000-0000-0000-0000-000000000001',
    status: 'active',
    billing_cycle: 'monthly',
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    cancel_at: null,
    cancelled_at: null,
    last_invoice_amount_cents: null,
    last_invoice_paid_at: null,
    stripe_subscription_id: null,
    stripe_customer_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as TenantSubscription
}

// ── formatCents ────────────────────────────────────────────────────────

describe('formatCents', () => {
  it('returns em-dash for null / undefined', () => {
    expect(formatCents(null)).toBe('—')
    expect(formatCents(undefined)).toBe('—')
  })

  it('formats integer dollars without decimals', () => {
    expect(formatCents(0)).toBe('$0')
    expect(formatCents(9900)).toBe('$99')
    expect(formatCents(199900)).toBe('$1,999')
  })

  it('shows fractional cents up to 2 places when present', () => {
    // minimumFractionDigits: 0 hides cents on round dollars but the
    // currency-style default maximumFractionDigits of 2 surfaces them
    // when the amount has fractional cents.
    expect(formatCents(9999)).toBe('$99.99')
    // Trailing zero is dropped because minimumFractionDigits is 0.
    expect(formatCents(9950)).toBe('$99.5')
  })
})

// ── statusTone ─────────────────────────────────────────────────────────

describe('statusTone', () => {
  // Every defined status must map to one of the four tones — the admin
  // UI hard-codes class names for each tone, so an unmapped status
  // would silently render with no styling.
  const cases: ReadonlyArray<[SubscriptionStatus, string]> = [
    ['active', 'success'],
    ['trialing', 'success'],
    ['past_due', 'warning'],
    ['incomplete', 'warning'],
    ['unpaid', 'error'],
    ['cancelled', 'error'],
    ['incomplete_expired', 'error'],
  ]

  for (const [status, tone] of cases) {
    it(`${status} → ${tone}`, () => {
      expect(statusTone(status)).toBe(tone)
    })
  }
})

// ── isTrialing ─────────────────────────────────────────────────────────

describe('isTrialing', () => {
  it('returns true only when status is exactly "trialing"', () => {
    expect(isTrialing(makeSub({ status: 'trialing' }))).toBe(true)
    expect(isTrialing(makeSub({ status: 'active' }))).toBe(false)
    expect(isTrialing(makeSub({ status: 'past_due' }))).toBe(false)
    expect(isTrialing(makeSub({ status: 'cancelled' }))).toBe(false)
  })

  it('does not look at trial_ends_at — status is the source of truth', () => {
    // A subscription mid-trial that the webhook flipped to active
    // (trial converted) still has trial_ends_at populated. We must
    // NOT report it as trialing.
    const future = new Date(Date.now() + 86_400_000 * 7).toISOString()
    expect(
      isTrialing(makeSub({ status: 'active', trial_ends_at: future })),
    ).toBe(false)
  })
})

// ── trialDaysRemaining ─────────────────────────────────────────────────

describe('trialDaysRemaining', () => {
  it('returns null when trial_ends_at is null', () => {
    expect(trialDaysRemaining(makeSub({ trial_ends_at: null }))).toBeNull()
  })

  it('returns 0 when the trial has already ended', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    expect(trialDaysRemaining(makeSub({ trial_ends_at: past }))).toBe(0)
  })

  it('rounds up — partial days count as a full remaining day', () => {
    // 12 hours from now: ceil(0.5) = 1.
    const halfDayOut = new Date(Date.now() + 12 * 3600_000).toISOString()
    expect(trialDaysRemaining(makeSub({ trial_ends_at: halfDayOut }))).toBe(1)
  })

  it('counts whole days correctly out to 14d', () => {
    const fourteenDaysOut = new Date(
      Date.now() + 14 * 86_400_000 + 3600_000,
    ).toISOString()
    // ceil((14d + 1h) / 1d) = 15
    expect(
      trialDaysRemaining(makeSub({ trial_ends_at: fourteenDaysOut })),
    ).toBe(15)
  })
})

// ── planFeatures / planHasFeature ──────────────────────────────────────

describe('planFeatures', () => {
  it('returns the array when features is a populated array', () => {
    const plan = makePlan({
      features: ['multi_shop', 'ai_appraisal', 'whatsapp'],
    })
    expect(planFeatures(plan)).toEqual([
      'multi_shop',
      'ai_appraisal',
      'whatsapp',
    ])
  })

  it('returns [] when features is null', () => {
    const plan = makePlan({ features: null as never })
    expect(planFeatures(plan)).toEqual([])
  })

  it('returns [] when features is an object (malformed config)', () => {
    const plan = makePlan({ features: { wrong: 'shape' } as never })
    expect(planFeatures(plan)).toEqual([])
  })

  it('returns [] when features is an empty array', () => {
    const plan = makePlan({ features: [] })
    expect(planFeatures(plan)).toEqual([])
  })
})

describe('planHasFeature', () => {
  it('returns true when the feature is present', () => {
    const plan = makePlan({ features: ['multi_shop'] })
    expect(planHasFeature(plan, 'multi_shop')).toBe(true)
  })

  it('returns false when absent', () => {
    const plan = makePlan({ features: ['multi_shop'] })
    expect(planHasFeature(plan, 'whatsapp')).toBe(false)
  })

  it('is case-sensitive', () => {
    const plan = makePlan({ features: ['multi_shop'] })
    expect(planHasFeature(plan, 'Multi_Shop')).toBe(false)
  })
})

// ── planLimit ──────────────────────────────────────────────────────────

describe('planLimit', () => {
  it('returns the numeric limit when set', () => {
    const plan = makePlan({
      feature_limits: { active_loans: 100, staff_users: 5 } as never,
    })
    expect(planLimit(plan, 'active_loans')).toBe(100)
    expect(planLimit(plan, 'staff_users')).toBe(5)
  })

  it('returns null when the key is missing', () => {
    const plan = makePlan({ feature_limits: { active_loans: 100 } as never })
    expect(planLimit(plan, 'staff_users')).toBeNull()
  })

  it('returns null when the value is explicitly null (unlimited)', () => {
    const plan = makePlan({
      feature_limits: { active_loans: null } as never,
    })
    expect(planLimit(plan, 'active_loans')).toBeNull()
  })

  it('returns null when feature_limits column itself is null', () => {
    const plan = makePlan({ feature_limits: null as never })
    expect(planLimit(plan, 'active_loans')).toBeNull()
  })

  it('returns null when feature_limits is an empty object', () => {
    const plan = makePlan({ feature_limits: {} as never })
    expect(planLimit(plan, 'active_loans')).toBeNull()
  })

  it('honors zero as a hard limit (not unlimited)', () => {
    // A plan that says "0 staff_users beyond the owner" must NOT be
    // treated as unlimited just because the value is falsy. nullish
    // coalescing in the implementation guards against this.
    const plan = makePlan({
      feature_limits: { staff_users: 0 } as never,
    })
    expect(planLimit(plan, 'staff_users')).toBe(0)
  })
})
