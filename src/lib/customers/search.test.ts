import { describe, expect, it } from 'vitest'
import { customerSearchFilters, phoneDigits } from './search'

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
  it('matches a typed phone number on its digits, whatever the formatting', () => {
    const P = '[^0-9]*'
    const re = '8136475237'.split('').join(P)
    expect(customerSearchFilters('8136475237', ['last_name', 'phone'])).toEqual([
      `last_name.ilike.%8136475237%,phone.match.${re}`,
    ])
    expect(customerSearchFilters('(813) 647-5237', ['phone'])).toEqual([
      `phone.match.${'813'.split('').join(P)}`,
      `phone.match.${'6475237'.split('').join(P)}`,
    ])
    // The pattern really finds the stored, formatted number.
    expect(new RegExp(re).test('(813) 647-5237')).toBe(true)
    expect(new RegExp(re).test('813.647.5237')).toBe(true)
  })
  it('phoneDigits', () => {
    expect(phoneDigits('+1-813-647-5237')).toBe('8136475237')
    expect(phoneDigits('12')).toBeNull()
    expect(phoneDigits('rodriguez')).toBeNull()
    expect(phoneDigits('D123-456')).toBeNull()
  })
})
