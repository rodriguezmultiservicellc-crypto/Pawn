import { describe, expect, it } from 'vitest'
import { buildRange, reportBounds, reportToday } from './range'

const NY = 'America/New_York'
// 2026-11-14 01:30 UTC = 2026-11-13 20:30 in New York.
const EVENING = new Date(Date.UTC(2026, 10, 14, 1, 30))

describe('buildRange', () => {
  it("defaults to the shop's today, not UTC's", () => {
    expect(buildRange({ timezone: NY, now: EVENING })).toEqual({ from: '2026-11-13', to: '2026-11-13', timezone: NY })
    expect(buildRange({ timezone: 'UTC', now: EVENING }).from).toBe('2026-11-14')
  })
  it('applies default offsets and keeps valid requested dates', () => {
    expect(buildRange({ timezone: NY, now: EVENING, defaultFromDays: -30 }).from).toBe('2026-10-14')
    expect(buildRange({ timezone: NY, now: EVENING, defaultToDays: 30 }).to).toBe('2026-12-13')
    expect(buildRange({ timezone: NY, from: '2026-01-01', to: '2026-01-31' })).toMatchObject({ from: '2026-01-01', to: '2026-01-31' })
  })
  it('ignores malformed dates and swaps a reversed range', () => {
    expect(buildRange({ timezone: NY, now: EVENING, from: 'nope' }).from).toBe('2026-11-13')
    expect(buildRange({ timezone: NY, from: '2026-02-10', to: '2026-02-01' })).toMatchObject({ from: '2026-02-01', to: '2026-02-10' })
  })
})

describe('reportBounds', () => {
  it("cuts days at the shop's midnight", () => {
    const b = reportBounds({ from: '2026-11-13', to: '2026-11-13', timezone: NY })
    expect(b).toEqual({ fromIso: '2026-11-13T05:00:00.000Z', toExclusiveIso: '2026-11-14T05:00:00.000Z' })
    // The 8:30 PM sale above falls inside Nov 13.
    expect(EVENING.toISOString() >= b.fromIso && EVENING.toISOString() < b.toExclusiveIso).toBe(true)
  })
  it('spans a DST change correctly', () => {
    expect(reportBounds({ from: '2026-10-31', to: '2026-11-01', timezone: NY })).toEqual({
      fromIso: '2026-10-31T04:00:00.000Z',
      toExclusiveIso: '2026-11-02T05:00:00.000Z',
    })
  })
})

describe('reportToday', () => {
  it('is the shop date', () => {
    expect(reportToday({ timezone: NY }, EVENING)).toBe('2026-11-13')
  })
})
