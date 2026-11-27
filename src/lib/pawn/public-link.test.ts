import { describe, expect, it } from 'vitest'
import { isValidPawnToken, newPawnToken, pawnTrackingUrl } from './public-link'

describe('pawn customer link', () => {
  it('makes 32-hex tokens and accepts only those', () => {
    const t = newPawnToken()
    expect(t).toMatch(/^[0-9a-f]{32}$/)
    expect(isValidPawnToken(t)).toBe(true)
    expect(isValidPawnToken('ABC')).toBe(false)
    expect(isValidPawnToken(t.toUpperCase())).toBe(false)
    expect(isValidPawnToken(null)).toBe(false)
  })

  it('builds /p/<token> on the app URL', () => {
    const t = '3d8f205c3c8a475993400594ef413d5b'
    expect(pawnTrackingUrl(t, 'https://pawn-three.vercel.app/')).toBe(`https://pawn-three.vercel.app/p/${t}`)
    expect(pawnTrackingUrl('nope', 'https://x')).toBeNull()
    expect(pawnTrackingUrl(null, 'https://x')).toBeNull()
  })
})
