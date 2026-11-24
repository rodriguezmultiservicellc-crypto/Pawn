import { describe, expect, it } from 'vitest'
import { inventorySearchFilters, searchWords, wordFilter } from './search'

describe('searchWords', () => {
  it('splits on spaces and drops what PostgREST reserves', () => {
    expect(searchWords('  14k   ring ')).toEqual(['14k', 'ring'])
    expect(searchWords('a,b (c) "d"')).toEqual(['ab', 'c', 'd'])
    expect(searchWords('')).toEqual([])
  })

  it('keeps at most six words', () => {
    expect(searchWords('a b c d e f g h')).toHaveLength(6)
  })
})

describe('wordFilter', () => {
  it('matches the text fields, legacy code and karat included', () => {
    const f = wordFilter('14k')
    expect(f).toContain('legacy_code.ilike.%14k%')
    expect(f).toContain('karat.ilike.%14k%')
    expect(f).toContain('description.ilike.%14k%')
    expect(f).not.toContain('weight_')
  })

  it('escapes the LIKE wildcards', () => {
    expect(wordFilter('10%')).toContain('sku.ilike.%10\\%%')
  })

  it('a plain number is a weight in grams or dwt', () => {
    const f = wordFilter('2.4')
    expect(f).toContain('weight_grams.eq.2.4')
    expect(f).toContain('weight_dwt.eq.2.4')
  })

  it('a unit picks the weight', () => {
    expect(wordFilter('2.4g')).toContain('weight_grams.eq.2.4')
    expect(wordFilter('2.4g')).not.toContain('weight_dwt')
    expect(wordFilter('1.5dwt')).toContain('weight_dwt.eq.1.5')
    expect(wordFilter('1.5dwt')).not.toContain('weight_grams')
  })

  it('a metal word finds every metal named with it, in English or Spanish', () => {
    expect(wordFilter('gold')).toContain('metal.in.(gold,rose_gold,white_gold)')
    expect(wordFilter('plata')).toContain('metal.in.(silver)')
  })

  it('a category word finds the category, in English or Spanish', () => {
    expect(wordFilter('ring')).toContain('category.in.(ring)')
    expect(wordFilter('anillo')).toContain('category.in.(ring)')
    expect(wordFilter('cadena')).toContain('category.in.(chain)')
  })

  it('short words do not match metals or categories', () => {
    expect(wordFilter('go')).not.toContain('metal.in')
  })
})

describe('inventorySearchFilters', () => {
  it('one filter per word', () => {
    expect(inventorySearchFilters('14k 2.4g ring')).toHaveLength(3)
  })
})
