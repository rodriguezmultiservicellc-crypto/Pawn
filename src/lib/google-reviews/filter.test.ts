// src/lib/google-reviews/filter.test.ts
import { describe, it, expect } from 'vitest'
import { applyHiddenFilter, applyMinStarFloor, isWidgetRenderable } from './filter'
import type { GoogleReview } from './types'

function r(rating: number, time: number, text = 'x'): GoogleReview {
  return { author_name: 'A', rating, time, text }
}

describe('applyMinStarFloor', () => {
  it('filters reviews below the floor', () => {
    const reviews = [r(5, 3), r(4, 2), r(3, 1)]
    expect(applyMinStarFloor(reviews, 4)).toEqual([r(5, 3), r(4, 2)])
  })

  it('floor=1 keeps everything', () => {
    const reviews = [r(5, 3), r(4, 2), r(1, 1)]
    expect(applyMinStarFloor(reviews, 1)).toHaveLength(3)
  })

  it('floor=5 keeps only 5-star', () => {
    const reviews = [r(5, 3), r(4, 2), r(5, 1)]
    expect(applyMinStarFloor(reviews, 5)).toHaveLength(2)
  })

  it('sorts surviving reviews by time DESC (newest first)', () => {
    const reviews = [r(5, 1), r(5, 3), r(5, 2)]
    const out = applyMinStarFloor(reviews, 4)
    expect(out.map((x) => x.time)).toEqual([3, 2, 1])
  })

  it('caps at 3 visible even when more survive the filter', () => {
    const reviews = [r(5, 5), r(5, 4), r(5, 3), r(5, 2), r(5, 1)]
    const out = applyMinStarFloor(reviews, 4)
    expect(out).toHaveLength(3)
    expect(out.map((x) => x.time)).toEqual([5, 4, 3])
  })

  it('returns empty array when no reviews survive', () => {
    const reviews = [r(2, 1), r(3, 2)]
    expect(applyMinStarFloor(reviews, 4)).toEqual([])
  })

  it('handles undefined reviews input', () => {
    expect(applyMinStarFloor(undefined as unknown as GoogleReview[], 4)).toEqual([])
  })

  it('handles null reviews input', () => {
    expect(applyMinStarFloor(null as unknown as GoogleReview[], 4)).toEqual([])
  })

  it('clamps non-finite ratings as if they fail the filter', () => {
    const reviews = [r(NaN as unknown as number, 1), r(5, 2)]
    expect(applyMinStarFloor(reviews, 4)).toEqual([r(5, 2)])
  })
})

describe('applyHiddenFilter', () => {
  it('drops reviews whose time is in the hidden list', () => {
    const reviews = [r(5, 100), r(5, 200), r(5, 300)]
    expect(applyHiddenFilter(reviews, [200])).toEqual([r(5, 100), r(5, 300)])
  })

  it('returns input unchanged when hidden list is empty', () => {
    const reviews = [r(5, 100), r(5, 200)]
    expect(applyHiddenFilter(reviews, [])).toEqual(reviews)
  })

  it('returns input unchanged when hidden list is null', () => {
    const reviews = [r(5, 100)]
    expect(applyHiddenFilter(reviews, null)).toEqual(reviews)
  })

  it('returns empty when reviews input is undefined', () => {
    expect(applyHiddenFilter(undefined, [100])).toEqual([])
  })

  it('drops all reviews when every time is hidden', () => {
    const reviews = [r(5, 100), r(5, 200)]
    expect(applyHiddenFilter(reviews, [100, 200])).toEqual([])
  })
})

describe('isWidgetRenderable', () => {
  it('false when fetchedAt is null', () => {
    expect(
      isWidgetRenderable({ fetchedAt: null, filteredReviews: [r(5, 1)] }),
    ).toBe(false)
  })

  it('false when filteredReviews is empty', () => {
    expect(
      isWidgetRenderable({ fetchedAt: new Date(), filteredReviews: [] }),
    ).toBe(false)
  })

  it('true when fetchedAt set and ≥1 review', () => {
    expect(
      isWidgetRenderable({ fetchedAt: new Date(), filteredReviews: [r(5, 1)] }),
    ).toBe(true)
  })
})
