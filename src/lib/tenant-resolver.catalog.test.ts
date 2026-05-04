import { describe, expect, it } from 'vitest'
import {
  PUBLIC_CATALOG_COLUMNS,
  escapeIlikeLiteral,
  resolveCatalogPagination,
} from './tenant-resolver'

describe('PUBLIC_CATALOG_COLUMNS', () => {
  // Defense-in-depth: the SELECT list never asks for these. If a future
  // edit reintroduces one, this test fires before it ships.
  const FORBIDDEN = [
    'cost_basis',
    'acquired_cost',
    'sale_price',
    'sold_at',
    'source',
    'source_loan_id',
    'source_repair_id',
    'source_vendor',
    'staff_memo',
    'notes',
    'tags',
    'location',
    'hold_until',
    'released_from_hold_at',
    'created_by',
    'updated_by',
  ]

  it('does not include any internal-only columns', () => {
    const cols = PUBLIC_CATALOG_COLUMNS.split(',').map((c) => c.trim())
    for (const f of FORBIDDEN) {
      expect(cols, `"${f}" must not be in PUBLIC_CATALOG_COLUMNS`).not.toContain(f)
    }
  })

  it('includes the columns the catalog renders', () => {
    const cols = PUBLIC_CATALOG_COLUMNS.split(',').map((c) => c.trim())
    for (const required of [
      'id',
      'sku',
      'description',
      'category',
      'list_price',
      'created_at',
    ]) {
      expect(cols).toContain(required)
    }
  })
})

describe('escapeIlikeLiteral', () => {
  it('escapes percent signs', () => {
    expect(escapeIlikeLiteral('50% off')).toBe('50\\% off')
  })

  it('escapes underscores', () => {
    expect(escapeIlikeLiteral('foo_bar')).toBe('foo\\_bar')
  })

  it('escapes backslashes', () => {
    expect(escapeIlikeLiteral('a\\b')).toBe('a\\\\b')
  })

  it('escapes all three special chars together', () => {
    expect(escapeIlikeLiteral('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })

  it('returns plain strings unchanged', () => {
    expect(escapeIlikeLiteral('hello world')).toBe('hello world')
  })
})

describe('resolveCatalogPagination', () => {
  it('handles a normal in-range page', () => {
    // total=50, pageSize=24 → 3 pages (24+24+2). Page 2 has more.
    expect(resolveCatalogPagination({ total: 50, page: 2, pageSize: 24 })).toEqual({
      page: 2,
      offset: 24,
      limit: 24,
      hasMore: true,
      totalPages: 3,
    })
  })

  it('marks hasMore=true when there are more pages', () => {
    expect(resolveCatalogPagination({ total: 100, page: 2, pageSize: 24 })).toEqual({
      page: 2,
      offset: 24,
      limit: 24,
      hasMore: true,
      totalPages: 5,
    })
  })

  it('normalizes page=0 to page=1', () => {
    expect(resolveCatalogPagination({ total: 10, page: 0, pageSize: 24 })).toEqual({
      page: 1,
      offset: 0,
      limit: 24,
      hasMore: false,
      totalPages: 1,
    })
  })

  it('normalizes negative page to page=1', () => {
    const r = resolveCatalogPagination({ total: 10, page: -5, pageSize: 24 })
    expect(r.page).toBe(1)
    expect(r.offset).toBe(0)
  })

  it('normalizes NaN page to page=1', () => {
    const r = resolveCatalogPagination({ total: 10, page: Number.NaN, pageSize: 24 })
    expect(r.page).toBe(1)
  })

  it('caps page at totalPages when given a too-large page', () => {
    const r = resolveCatalogPagination({ total: 10, page: 99, pageSize: 24 })
    expect(r.page).toBe(1)
    expect(r.offset).toBe(0)
    expect(r.totalPages).toBe(1)
  })

  it('returns totalPages=0 and offset=0 when total=0', () => {
    expect(resolveCatalogPagination({ total: 0, page: 1, pageSize: 24 })).toEqual({
      page: 1,
      offset: 0,
      limit: 24,
      hasMore: false,
      totalPages: 0,
    })
  })

  it('handles last partial page correctly', () => {
    // total=50, page=3, pageSize=24 → offset=48, only 2 items remain.
    // hasMore=false because page 3 is the last one.
    const r = resolveCatalogPagination({ total: 50, page: 3, pageSize: 24 })
    expect(r.page).toBe(3)
    expect(r.offset).toBe(48)
    expect(r.hasMore).toBe(false)
    expect(r.totalPages).toBe(3)
  })
})
