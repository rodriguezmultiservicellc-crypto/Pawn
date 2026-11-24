import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import {
  GENERAL_COLOR_KEYS,
  JEWELRY_COLOR_KEYS,
  STONE_TYPE_KEYS,
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

  it('have no word in the dictionary that no list offers', () => {
    const offeredColors = new Set<string>([...JEWELRY_COLOR_KEYS, ...GENERAL_COLOR_KEYS])
    expect(Object.keys(en.pawn.new_.colors).filter((k) => !offeredColors.has(k))).toEqual([])
    const offeredStyles = new Set<string>(styleKeysFor('other'))
    expect(Object.keys(en.pawn.new_.styles).filter((k) => !offeredStyles.has(k))).toEqual([])
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

describe('the Stone choices', () => {
  const stonesEs = choicesFrom(STONE_TYPE_KEYS, en.pawn.new_.stoneTypes, es.pawn.new_.stoneTypes)

  it('have a word in both dictionaries for every key, and no word no list offers', () => {
    for (const k of STONE_TYPE_KEYS) {
      expect(en.pawn.new_.stoneTypes[k], k).toBeTruthy()
      expect(es.pawn.new_.stoneTypes[k], k).toBeTruthy()
    }
    const offered = new Set<string>(STONE_TYPE_KEYS)
    expect(Object.keys(en.pawn.new_.stoneTypes).filter((k) => !offered.has(k))).toEqual([])
    expect(Object.keys(es.pawn.new_.stoneTypes).filter((k) => !offered.has(k))).toEqual([])
  })

  it('save the English word, and keep a lab-grown diamond apart from a mined one', () => {
    expect(matchChoice('rubí', stonesEs)?.value).toBe('Ruby')
    expect(matchChoice('Diamante de laboratorio', stonesEs)?.value).toBe('Lab-grown diamond')
    expect(matchChoice('diamond', stonesEs)?.value).toBe('Diamond')
    expect(matchChoice('3 stones', stonesEs)).toBeNull()
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
