// src/lib/google-reviews/format.test.ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime, truncateExcerpt, starArray } from './format'

describe('formatRelativeTime (en)', () => {
  const NOW = new Date('2026-05-05T12:00:00Z').getTime()

  it('returns "just now" for < 60s', () => {
    expect(formatRelativeTime(NOW / 1000 - 30, 'en', NOW)).toBe('just now')
  })

  it('returns "just now" for future timestamps (clock skew tolerance)', () => {
    // Negative diff (timestamp in future) collapses to the < 60s branch.
    // Documents the contract — production callers feed Google's `r.time`
    // which is always in the past, so this is a defensive policy choice.
    expect(formatRelativeTime(NOW / 1000 + 300, 'en', NOW)).toBe('just now')
  })

  it('returns minutes for < 1h', () => {
    expect(formatRelativeTime(NOW / 1000 - 60 * 30, 'en', NOW)).toMatch(/30 min/)
  })

  it('returns hours for < 24h', () => {
    expect(formatRelativeTime(NOW / 1000 - 60 * 60 * 5, 'en', NOW)).toMatch(/5 hr/)
  })

  it('returns days for < 7d', () => {
    expect(formatRelativeTime(NOW / 1000 - 60 * 60 * 24 * 3, 'en', NOW)).toMatch(/3 days?/)
  })

  it('returns weeks for < 30d', () => {
    expect(formatRelativeTime(NOW / 1000 - 60 * 60 * 24 * 14, 'en', NOW)).toMatch(/2 wk|2 weeks?/)
  })

  it('returns months for ≥ 30d', () => {
    expect(formatRelativeTime(NOW / 1000 - 60 * 60 * 24 * 90, 'en', NOW)).toMatch(/3 mo/)
  })
})

describe('formatRelativeTime (es)', () => {
  const NOW = new Date('2026-05-05T12:00:00Z').getTime()

  it('localizes to spanish', () => {
    const out = formatRelativeTime(NOW / 1000 - 60 * 60 * 24 * 3, 'es', NOW)
    // es output looks like "hace 3 días" — assert spanish marker
    expect(out).toMatch(/hace/)
  })
})

describe('truncateExcerpt', () => {
  it('returns text unchanged when shorter than max', () => {
    expect(truncateExcerpt('short text', 140)).toBe('short text')
  })

  it('returns text unchanged when exactly max', () => {
    const t = 'a'.repeat(140)
    expect(truncateExcerpt(t, 140)).toBe(t)
  })

  it('truncates at word boundary with ellipsis', () => {
    const t = 'one two three four five six seven eight nine ten'
    const out = truncateExcerpt(t, 20)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(21)  // 20 + ellipsis char
    // No mid-word cut — the cut should land at the last full word that
    // fits inside maxChars.
    expect(out.replace('…', '').trim()).toBe('one two three four')
  })

  it('handles empty / null gracefully', () => {
    expect(truncateExcerpt('', 140)).toBe('')
    expect(truncateExcerpt(null as unknown as string, 140)).toBe('')
  })

  it('collapses whitespace', () => {
    expect(truncateExcerpt('a  \n\n  b', 140)).toBe('a b')
  })
})

describe('starArray', () => {
  it('rating 5 → all filled', () => {
    expect(starArray(5)).toEqual([true, true, true, true, true])
  })

  it('rating 0 → all empty', () => {
    expect(starArray(0)).toEqual([false, false, false, false, false])
  })

  it('rating 4 → 4 filled + 1 empty', () => {
    expect(starArray(4)).toEqual([true, true, true, true, false])
  })

  it('rating 4.5 → rounds to 5 filled (no half stars v1)', () => {
    expect(starArray(4.5)).toEqual([true, true, true, true, true])
  })

  it('rating 3.4 → 3 filled', () => {
    expect(starArray(3.4)).toEqual([true, true, true, false, false])
  })

  it('rating NaN → all empty', () => {
    expect(starArray(NaN)).toEqual([false, false, false, false, false])
  })
})
