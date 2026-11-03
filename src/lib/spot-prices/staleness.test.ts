import { describe, expect, it } from 'vitest'
import {
  SPOT_STALE_AFTER_HOURS,
  assessSpotFreshness,
  newestFetchedAt,
  staleAgeLabelHours,
} from './staleness'

const NOW = Date.parse('2026-11-03T20:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

describe('assessSpotFreshness', () => {
  it('treats a fresh price as fresh', () => {
    const f = assessSpotFreshness(hoursAgo(2), NOW)
    expect(f.stale).toBe(false)
    expect(f.ageHours).toBeCloseTo(2, 6)
  })

  it('flips to stale strictly after the threshold', () => {
    expect(assessSpotFreshness(hoursAgo(SPOT_STALE_AFTER_HOURS), NOW).stale).toBe(false)
    expect(assessSpotFreshness(hoursAgo(SPOT_STALE_AFTER_HOURS + 0.01), NOW).stale).toBe(true)
  })

  it('calls a six-month-old price stale (the April→November freeze)', () => {
    const f = assessSpotFreshness('2026-04-30T14:14:52.957Z', NOW)
    expect(f.stale).toBe(true)
    expect(f.ageHours).toBeGreaterThan(24 * 180)
  })

  it('treats no price at all as stale — nothing to price from', () => {
    expect(assessSpotFreshness(null, NOW)).toEqual({
      newestFetchedAt: null,
      ageHours: null,
      stale: true,
    })
    expect(assessSpotFreshness('not a date', NOW).stale).toBe(true)
  })

  it('never reports a negative age for a clock slightly ahead', () => {
    expect(assessSpotFreshness(hoursAgo(-0.5), NOW).ageHours).toBe(0)
  })
})

describe('newestFetchedAt', () => {
  it('picks the latest timestamp and ignores empty rows', () => {
    expect(
      newestFetchedAt([
        { fetched_at: hoursAgo(5) },
        null,
        { fetched_at: null },
        { fetched_at: hoursAgo(1) },
        { fetched_at: hoursAgo(30) },
      ]),
    ).toBe(hoursAgo(1))
  })

  it('returns null for no rows', () => {
    expect(newestFetchedAt([])).toBeNull()
  })
})

describe('staleAgeLabelHours', () => {
  it('floors to whole hours', () => {
    expect(staleAgeLabelHours(25.9)).toBe(25)
    expect(staleAgeLabelHours(null)).toBeNull()
  })
})
