/**
 * Ring-size conversions (brief Phase 4.1). Pure.
 *
 * Everything goes through the INSIDE DIAMETER in millimetres:
 *
 *   US / Canada / Mexico  d = 11.63 + 0.8128 × size
 *       (each whole size = 0.032 in = 0.8128 mm of diameter; size 7 →
 *        17.32 mm, the usual reference value). Mexico uses the same
 *        numeric scale as the US — there is no separate Mexican scale.
 *   EU / ISO 8653          size = inside circumference in mm = d × π
 *   Japan (JIS, approx.)   d = 13.0 + (size − 1) / 3
 *       (size 1 = 13.0 mm; +1/3 mm per size. Published JIS tables round
 *        each step, so a converted value can differ by ~0.1 mm from a
 *        printed chart — fine for the bench, say so in the UI.)
 *
 * Results are rounded to 2 dp (mm) / 2 dp (US) / 1 dp (EU, JP) — a
 * mandrel is not more precise than that.
 */

export type RingScale = 'us' | 'eu' | 'jp' | 'mm'

export type RingSizes = {
  /** Inside diameter, mm. */
  diameterMm: number
  /** Inside circumference, mm (= EU / ISO size). */
  circumferenceMm: number
  us: number
  eu: number
  jp: number
}

const US_INTERCEPT = 11.63
const US_STEP = 0.8128
const JP_BASE = 13.0
const JP_STEP = 1 / 3

export function diameterFromUs(us: number): number {
  return US_INTERCEPT + US_STEP * us
}
export function usFromDiameter(d: number): number {
  return (d - US_INTERCEPT) / US_STEP
}
export function diameterFromEu(eu: number): number {
  return eu / Math.PI
}
export function euFromDiameter(d: number): number {
  return d * Math.PI
}
export function diameterFromJp(jp: number): number {
  return JP_BASE + (jp - 1) * JP_STEP
}
export function jpFromDiameter(d: number): number {
  return (d - JP_BASE) / JP_STEP + 1
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Convert one known size on `scale` to every scale. Null for junk / out of range. */
export function convertRingSize(scale: RingScale, value: number): RingSizes | null {
  if (!Number.isFinite(value)) return null
  let d: number
  switch (scale) {
    case 'us':
      d = diameterFromUs(value)
      break
    case 'eu':
      d = diameterFromEu(value)
      break
    case 'jp':
      d = diameterFromJp(value)
      break
    case 'mm':
      d = value
      break
  }
  // Below a child's size 0 or above a US 16 is a typo, not a ring.
  if (!(d >= 11 && d <= 25)) return null
  return {
    diameterMm: round(d, 2),
    circumferenceMm: round(euFromDiameter(d), 1),
    us: round(usFromDiameter(d), 2),
    eu: round(euFromDiameter(d), 1),
    jp: round(jpFromDiameter(d), 1),
  }
}

/** Nearest US quarter size — what the mandrel actually has. */
export function nearestUsQuarter(us: number): number {
  return Math.round(us * 4) / 4
}
