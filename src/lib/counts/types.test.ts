import { describe, expect, it } from 'vitest'
import {
  countErrorToken,
  exceptionSeverity,
  readBatchSchema,
  sortFindings,
  startCountSchema,
  type ExceptionKind,
} from './types'

describe('countErrorToken', () => {
  it('maps database messages to tokens', () => {
    expect(countErrorToken('ERROR: P0001: count_pledge_note_required')).toBe('count_pledge_note_required')
    expect(countErrorToken('count_note_required')).toBe('count_note_required')
    expect(countErrorToken('count_not_open')).toBe('count_not_open')
    expect(countErrorToken('count_not_found')).toBe('count_not_found')
    expect(countErrorToken('connection reset')).toBe('count_failed')
    expect(countErrorToken(undefined)).toBe('count_failed')
  })
})

describe('exceptionSeverity', () => {
  it('ranks a missing pledge and pledges out of place as danger', () => {
    expect(exceptionSeverity('missing_pledge', null)).toBe('danger')
    expect(exceptionSeverity('unexpected', 'loan_closed')).toBe('danger')
    expect(exceptionSeverity('unexpected', 'pledged_item')).toBe('danger')
  })
  it('ranks stock problems as warnings and the rest as info', () => {
    expect(exceptionSeverity('missing', null)).toBe('warning')
    expect(exceptionSeverity('held_in_sales', null)).toBe('warning')
    expect(exceptionSeverity('unexpected', 'not_in_stock')).toBe('warning')
    expect(exceptionSeverity('unexpected', 'other_location')).toBe('info')
    expect(exceptionSeverity('left_during_count', 'sold')).toBe('info')
  })
})

describe('sortFindings', () => {
  it('puts the worst first, then by kind and code', () => {
    const rows: Array<{ kind: ExceptionKind; reason: string | null; code: string | null }> = [
      { kind: 'left_during_count', reason: 'sold', code: 'INV-000009' },
      { kind: 'missing', reason: null, code: 'INV-000002' },
      { kind: 'unexpected', reason: 'unknown_code', code: 'ZZZ' },
      { kind: 'missing_pledge', reason: null, code: 'PT-000001-1' },
      { kind: 'missing', reason: null, code: 'INV-000001' },
    ]
    expect(sortFindings(rows).map((r) => r.code)).toEqual(['PT-000001-1', 'INV-000001', 'INV-000002', 'ZZZ', 'INV-000009'])
  })
})

describe('input schemas', () => {
  it('accepts a case count and blanks optional scope', () => {
    const r = startCountSchema.parse({ kind: 'case', location: 'case', shelf: '  ', category: '' })
    expect(r).toMatchObject({ kind: 'case', location: 'case', shelf: null, category: null })
  })
  it('rejects a case count without a location and a bad transfer id', () => {
    expect(startCountSchema.safeParse({ kind: 'case' }).success).toBe(false)
    expect(startCountSchema.safeParse({ kind: 'transfer', transferId: 'x' }).success).toBe(false)
  })
  it('caps a read batch at 500 codes', () => {
    expect(readBatchSchema.safeParse({ codes: Array(500).fill('1') }).success).toBe(true)
    expect(readBatchSchema.safeParse({ codes: Array(501).fill('1') }).success).toBe(false)
    expect(readBatchSchema.safeParse({ codes: [] }).success).toBe(false)
    expect(readBatchSchema.parse({ codes: ['a'] }).source).toBe('scanner')
  })
})
