/**
 * Which items go on the front of the ticket.
 *
 * Fla. Stat. § 539.001(8)(b) puts the lending terms and the statements on
 * the FRONT of the form. These tests pin the rule that keeps them there:
 * the front takes the items that fit beside the foot, the rest go to the
 * continuation sheet.
 */

import { describe, expect, it } from 'vitest'
import { itemsOnFront, wrapLines } from './PawnTransactionForm'

describe('wrapLines', () => {
  it('is one line for nothing or for a short text', () => {
    expect(wrapLines('', 20)).toBe(1)
    expect(wrapLines('Gold / Oro', 20)).toBe(1)
  })

  it('breaks at spaces', () => {
    expect(wrapLines('White gold / Oro blanco', 12)).toBe(2)
    expect(wrapLines('3 diamond (round, white, 0.75 ct, VS1); prong-set', 23)).toBe(3)
  })

  it('counts a word longer than the cell as several lines', () => {
    expect(wrapLines('356789012345678', 10)).toBe(2)
    expect(wrapLines('a 356789012345678901234', 10)).toBe(4)
  })

  it('never divides by a cell narrower than a character', () => {
    expect(wrapLines('abc', 0)).toBe(3)
  })
})

describe('itemsOnFront', () => {
  const none = { extraPledgorLines: 0, noticesEn: [], noticesEs: [] }

  it('keeps every item when they fit', () => {
    expect(itemsOnFront({ ...none, itemHeights: [56, 56, 56] })).toBe(3)
    expect(itemsOnFront({ ...none, itemHeights: [] })).toBe(0)
  })

  it('stops before the item that would push the foot off the sheet', () => {
    // No statements: 752 - 262 - 150 - 10 = 330 points for items.
    expect(itemsOnFront({ ...none, itemHeights: [100, 100, 100, 100] })).toBe(3)
    expect(itemsOnFront({ ...none, itemHeights: [70, 70, 70, 70, 70] })).toBe(4)
  })

  it('always puts the first item on the front, however tall', () => {
    expect(itemsOnFront({ ...none, itemHeights: [900, 50] })).toBe(1)
  })

  it('leaves less room when the statements are long', () => {
    const long = Array.from({ length: 4 }, () => 'x '.repeat(200))
    const few = itemsOnFront({ extraPledgorLines: 0, noticesEn: long, noticesEs: long, itemHeights: [56, 56, 56, 56, 56] })
    expect(few).toBeLessThan(itemsOnFront({ ...none, itemHeights: [56, 56, 56, 56, 56] }))
    expect(few).toBeGreaterThanOrEqual(1)
  })

  it('leaves less room when the address runs to more lines', () => {
    const heights = [80, 80, 80, 80]
    expect(itemsOnFront({ ...none, itemHeights: heights })).toBe(4)
    expect(itemsOnFront({ ...none, extraPledgorLines: 2, itemHeights: heights })).toBe(3)
  })
})
