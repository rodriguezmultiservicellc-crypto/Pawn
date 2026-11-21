import { describe, expect, it } from 'vitest'
import { customerSearchFilters } from './search'

const COLS = ['first_name', 'last_name'] as const

describe('customerSearchFilters', () => {
  it('makes one filter per word', () => {
    expect(customerSearchFilters('freddy rodriguez', COLS)).toEqual([
      'first_name.ilike.%freddy%,last_name.ilike.%freddy%',
      'first_name.ilike.%rodriguez%,last_name.ilike.%rodriguez%',
    ])
  })
  it('drops PostgREST syntax characters and extra spaces', () => {
    expect(customerSearchFilters('  Rodriguez,   Freddy ', COLS)).toEqual([
      'first_name.ilike.%Rodriguez%,last_name.ilike.%Rodriguez%',
      'first_name.ilike.%Freddy%,last_name.ilike.%Freddy%',
    ])
    expect(customerSearchFilters('(),', COLS)).toEqual([])
  })
  it('escapes LIKE wildcards', () => {
    expect(customerSearchFilters('a_b%', ['email'])).toEqual(['email.ilike.%a\\_b\\%%'])
  })
  it('caps at 6 words', () => {
    expect(customerSearchFilters('a b c d e f g h', ['x'])).toHaveLength(6)
  })
})
