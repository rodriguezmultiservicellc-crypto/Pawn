import { afterEach, describe, expect, it, vi } from 'vitest'
import { shortDate } from './money'

describe('shortDate', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('shows a bare date as that calendar day in every timezone', () => {
    // The bug: in a US timezone "2026-08-22" printed as 8/21/2026.
    for (const tz of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      vi.stubEnv('TZ', tz)
      const d = new Date(2026, 7, 22)
      expect(shortDate('2026-08-22'), tz).toBe(d.toLocaleDateString())
      expect(d.getDate(), tz).toBe(22)
    }
  })

  it('still shows a timestamp in the viewer’s timezone', () => {
    const iso = '2026-10-31T17:10:05.000Z'
    expect(shortDate(iso)).toBe(new Date(iso).toLocaleDateString())
  })

  it('is a dash for nothing or nonsense', () => {
    expect(shortDate(null)).toBe('—')
    expect(shortDate('')).toBe('—')
    expect(shortDate('not a date')).toBe('—')
  })
})
