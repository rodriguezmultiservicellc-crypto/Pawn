import { describe, expect, it } from 'vitest'
import {
  moneyTextToCents,
  principalAfterCollateralChange,
  principalFieldText,
} from './principal-follow'

/** Walk the principal through a run of collateral totals, as the form does. */
function follow(
  startText: string,
  steps: ReadonlyArray<{ count: number; total: number }>,
): string {
  let principal = moneyTextToCents(startText)
  let last = 0
  for (const s of steps) {
    const cents = Math.round(s.total * 100)
    principal = principalAfterCollateralChange(principal, cents - last, s.count)
    last = cents
  }
  return principalFieldText(principal)
}

describe('moneyTextToCents', () => {
  it('reads money as whole cents', () => {
    expect(moneyTextToCents('26')).toBe(2600)
    expect(moneyTextToCents('26.5')).toBe(2650)
    expect(moneyTextToCents('0.29')).toBe(29)
  })

  it('reads empty or unreadable text as zero', () => {
    expect(moneyTextToCents('')).toBe(0)
    expect(moneyTextToCents('abc')).toBe(0)
  })
})

describe('principalFieldText', () => {
  it('shows two decimals', () => {
    expect(principalFieldText(2600)).toBe('26.00')
    expect(principalFieldText(12650)).toBe('126.50')
  })

  it('is empty at zero or below', () => {
    expect(principalFieldText(0)).toBe('')
    expect(principalFieldText(-600)).toBe('')
  })
})

describe('the principal follows the collateral', () => {
  it('adds each item as it goes in', () => {
    expect(
      follow('', [
        { count: 1, total: 26 },
        { count: 2, total: 126 },
        { count: 3, total: 176.5 },
      ]),
    ).toBe('176.50')
  })

  it('follows a value as it is typed digit by digit', () => {
    expect(
      follow('', [
        { count: 1, total: 0 },
        { count: 1, total: 2 },
        { count: 1, total: 26 },
      ]),
    ).toBe('26.00')
  })

  it('takes an item off when it is removed', () => {
    expect(
      follow('', [
        { count: 1, total: 26 },
        { count: 2, total: 126 },
        { count: 1, total: 100 },
      ]),
    ).toBe('100.00')
  })

  it('keeps the amount the clerk typed and adds the next item to it', () => {
    // One item worth 26; the clerk lends 20; a second item worth 50 goes in.
    let principal = principalAfterCollateralChange(0, 2600, 1)
    expect(principalFieldText(principal)).toBe('26.00')
    principal = moneyTextToCents('20')
    principal = principalAfterCollateralChange(principal, 5000, 2)
    expect(principalFieldText(principal)).toBe('70.00')
  })

  it('lands right when a value is cleared and typed again', () => {
    // Lent 20 on a value of 26; the value is retyped as 30 -> 24.
    let principal = moneyTextToCents('20')
    principal = principalAfterCollateralChange(principal, -2400, 1) // "2"
    principal = principalAfterCollateralChange(principal, -200, 1) // ""
    expect(principalFieldText(principal)).toBe('')
    principal = principalAfterCollateralChange(principal, 300, 1) // "3"
    principal = principalAfterCollateralChange(principal, 2700, 1) // "30"
    expect(principalFieldText(principal)).toBe('24.00')
  })

  it('starts over at zero when the last item is removed', () => {
    let principal = moneyTextToCents('20')
    principal = principalAfterCollateralChange(principal, -2600, 0)
    expect(principal).toBe(0)
    principal = principalAfterCollateralChange(principal, 5000, 1)
    expect(principalFieldText(principal)).toBe('50.00')
  })

  it('does not drift over many items', () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({
      count: i + 1,
      total: Math.round((i + 1) * 0.1 * 100) / 100,
    }))
    expect(follow('', steps)).toBe('3.00')
  })
})
