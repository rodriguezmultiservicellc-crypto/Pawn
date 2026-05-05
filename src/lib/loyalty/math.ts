// src/lib/loyalty/math.ts

/**
 * Pure-logic loyalty math. No DB, no Supabase, no React. Every function here
 * is fully covered by math.test.ts.
 */

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 chars, no I/O/0/1
const REFERRAL_LENGTH = 6
const REFERRAL_REGEX = /^[A-HJ-NP-Z2-9]{6}$/

/**
 * Round to 2dp using a small epsilon to dodge float drift (1.005 → 1.01).
 */
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100
}

/**
 * Floor fractional points to integer. Negative inputs collapse to 0
 * (defensive — the caller should never pass negative subtotals).
 */
export function computeRetailEarn(subtotal: number, rate: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return Math.floor(subtotal * rate)
}

export function computeLoanInterestEarn(interest: number, rate: number): number {
  if (!Number.isFinite(interest) || interest <= 0) return 0
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return Math.floor(interest * rate)
}

/**
 * Redemption math. Caps the discount at saleSubtotal − alreadyDiscounted so
 * a sale's total can't go negative. When capped, pointsConsumed shrinks
 * proportionally — we only debit the points that actually bought discount.
 */
export function computeRedemptionDiscount(args: {
  points: number
  rate: number
  saleSubtotal: number
  alreadyDiscounted: number
}): { discount: number; pointsConsumed: number } {
  if (!Number.isFinite(args.points) || args.points <= 0) return { discount: 0, pointsConsumed: 0 }
  if (!Number.isFinite(args.rate) || args.rate <= 0) return { discount: 0, pointsConsumed: 0 }
  if (!Number.isFinite(args.saleSubtotal)) return { discount: 0, pointsConsumed: 0 }
  if (!Number.isFinite(args.alreadyDiscounted)) return { discount: 0, pointsConsumed: 0 }

  // Floor fractional points up-front — pointsConsumed lands in an INTEGER column.
  const points = Math.floor(args.points)
  if (points <= 0) return { discount: 0, pointsConsumed: 0 }

  const requestedDiscount = round2(points / args.rate)
  const remaining = round2(args.saleSubtotal - args.alreadyDiscounted)
  if (remaining <= 0) return { discount: 0, pointsConsumed: 0 }

  if (requestedDiscount <= remaining) {
    return { discount: requestedDiscount, pointsConsumed: points }
  }
  // Capped — back-compute how many points actually buy `remaining` of discount.
  const cappedPoints = Math.floor(remaining * args.rate)
  return { discount: round2(cappedPoints / args.rate), pointsConsumed: cappedPoints }
}

export function generateReferralCode(rng: () => number): string {
  let out = ''
  for (let i = 0; i < REFERRAL_LENGTH; i++) {
    const idx = Math.floor(rng() * REFERRAL_ALPHABET.length) % REFERRAL_ALPHABET.length
    out += REFERRAL_ALPHABET[idx]
  }
  return out
}

export function canApplyAdjustment(currentBalance: number, delta: number): boolean {
  return currentBalance + delta >= 0
}

export function isValidReferralCode(code: string): boolean {
  return REFERRAL_REGEX.test(code)
}

/**
 * Clawback-cap. Returns 0 when balance is 0, current balance when balance
 * is below the requested amount, or the requested amount otherwise.
 * Defensive on negative inputs — both treat as 0.
 */
export function clampClawback(args: {
  pointsToClaw: number
  currentBalance: number
}): number {
  if (!Number.isFinite(args.pointsToClaw) || args.pointsToClaw <= 0) return 0
  if (!Number.isFinite(args.currentBalance) || args.currentBalance <= 0) return 0
  return Math.min(args.pointsToClaw, args.currentBalance)
}
