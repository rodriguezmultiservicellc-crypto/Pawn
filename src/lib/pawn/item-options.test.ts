import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import {
  GENERAL_COLOR_KEYS,
  JEWELRY_COLOR_KEYS,
  choicesFrom,
  matchChoice,
  styleKeysFor,
} from './item-options'

const colorsEs = choicesFrom(JEWELRY_COLOR_KEYS, en.pawn.new_.colors, es.pawn.new_.colors)

describe('the Color and Style choices', () => {
  it('save the English word and show the screen language', () => {
    expect(colorsEs[0]).toEqual({ value: 'Yellow', label: 'Amarillo' })
  })

  it('have a word in both dictionaries for every key', () => {
    for (const k of [...JEWELRY_COLOR_KEYS, ...GENERAL_COLOR_KEYS]) {
      expect(en.pawn.new_.colors[k], k).toBeTruthy()
      expect(es.pawn.new_.colors[k], k).toBeTruthy()
    }
    for (const category of ['chain', 'necklace', 'bracelet', 'ring', 'earrings', 'pendant', 'watch', 'other']) {
      for (const k of styleKeysFor(category)) {
        expect(en.pawn.new_.styles[k], k).toBeTruthy()
        expect(es.pawn.new_.styles[k], k).toBeTruthy()
      }
    }
  })

  it('offer each kind of jewelry its own styles, and everything to a kind with no list', () => {
    expect(styleKeysFor('chain')).toContain('cuban_link')
    expect(styleKeysFor('chain')).not.toContain('solitaire')
    expect(styleKeysFor('ring')).toContain('solitaire')
    expect(styleKeysFor('earrings')).toEqual(['stud', 'hoop', 'huggie', 'dangle', 'cluster'])
    const all = styleKeysFor('other')
    expect(all).toContain('cuban_link')
    expect(all).toContain('pocket_watch')
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('matchChoice', () => {
  it('finds a saved English word, whatever its capitals', () => {
    expect(matchChoice('Yellow', colorsEs)?.value).toBe('Yellow')
    expect(matchChoice(' yellow ', colorsEs)?.value).toBe('Yellow')
    expect(matchChoice('TWO-TONE', colorsEs)?.value).toBe('Two-tone')
  })

  it('finds a word in the screen language and gives back the English one', () => {
    expect(matchChoice('amarillo', colorsEs)?.value).toBe('Yellow')
  })

  it('is nothing for an older value or an empty one, so it shows under Other', () => {
    expect(matchChoice('Yellow Gold', colorsEs)).toBeNull()
    expect(matchChoice('', colorsEs)).toBeNull()
  })
})
