import { describe, expect, it } from 'vitest'
import {
  descriptionOptions,
  EYE_COLOR_OPTIONS,
  HAIR_COLOR_OPTIONS,
  RACE_OPTIONS,
  SEX_OPTIONS,
} from './physical-description'

const hairLabels = {
  black: 'Black',
  brown: 'Brown',
  redAuburn: 'Red or auburn',
}

describe('descriptionOptions', () => {
  it('puts a blank option first so the field stays optional', () => {
    const opts = descriptionOptions(HAIR_COLOR_OPTIONS, hairLabels, null)
    expect(opts[0]).toEqual({ value: '', label: '—' })
  })

  it('labels each option from the dictionary, keeping the stored value', () => {
    const opts = descriptionOptions(HAIR_COLOR_OPTIONS, hairLabels, null)
    expect(opts).toContainEqual({ value: 'Black', label: 'Black' })
    expect(opts).toContainEqual({ value: 'Red Or Auburn', label: 'Red or auburn' })
  })

  it('falls back to the raw value when a label is missing', () => {
    // Guards a half-finished locale: the option must still be selectable.
    const opts = descriptionOptions(HAIR_COLOR_OPTIONS, {}, null)
    expect(opts).toContainEqual({ value: 'Blonde', label: 'Blonde' })
  })

  // The important one. 5,218 imported rows carry values that predate these
  // lists ('BLACK', 'black', 'Multicolor'). If the select dropped them, saving
  // an edit to an unrelated field would silently blank a field the FL pawn
  // statute requires us to hold.
  it('preserves an off-list stored value as its own option', () => {
    const opts = descriptionOptions(HAIR_COLOR_OPTIONS, hairLabels, 'BLACK')
    expect(opts).toContainEqual({ value: 'BLACK', label: 'BLACK' })
  })

  it('does not duplicate a value that is already canonical', () => {
    const opts = descriptionOptions(HAIR_COLOR_OPTIONS, hairLabels, 'Black')
    expect(opts.filter((o) => o.value === 'Black')).toHaveLength(1)
  })

  it('ignores blank and whitespace-only current values', () => {
    for (const current of [null, undefined, '', '   ']) {
      const opts = descriptionOptions(HAIR_COLOR_OPTIONS, hairLabels, current)
      expect(opts.filter((o) => o.value === '')).toHaveLength(1)
    }
  })

  it('trims a padded stored value before matching', () => {
    const opts = descriptionOptions(HAIR_COLOR_OPTIONS, hairLabels, '  Black  ')
    expect(opts.filter((o) => o.value === 'Black')).toHaveLength(1)
  })
})

describe('option vocabularies', () => {
  const lists = {
    sex: SEX_OPTIONS,
    hair: HAIR_COLOR_OPTIONS,
    eye: EYE_COLOR_OPTIONS,
    race: RACE_OPTIONS,
  }

  it.each(Object.entries(lists))('%s has unique values and keys', (_n, list) => {
    expect(new Set(list.map((o) => o.value)).size).toBe(list.length)
    expect(new Set(list.map((o) => o.key)).size).toBe(list.length)
  })

  it.each(Object.entries(lists))('%s stores no empty value', (_n, list) => {
    for (const o of list) expect(o.value.trim()).not.toBe('')
  })

  // These exact strings are what the 5,218 imported rows already contain.
  // Changing one silently orphans live data, so pin the observed vocabulary.
  it('covers the values present in the imported data', () => {
    const hair = HAIR_COLOR_OPTIONS.map((o) => o.value)
    for (const v of ['Black', 'Brown', 'Grey', 'Blonde', 'Bald',
      'Red Or Auburn', 'White', 'Auburn', 'Sandy', 'Orange', 'Blue',
      'Purple', 'Unknown']) {
      expect(hair).toContain(v)
    }

    const eye = EYE_COLOR_OPTIONS.map((o) => o.value)
    for (const v of ['Brown', 'Black', 'Blue', 'Green', 'Hazel', 'Grey',
      'Multicolor', 'Other']) {
      expect(eye).toContain(v)
    }

    const race = RACE_OPTIONS.map((o) => o.value)
    for (const v of ['Hispanic', 'White', 'Black', 'Asian', 'Unknown',
      'Other', 'Native American']) {
      expect(race).toContain(v)
    }

    expect(SEX_OPTIONS.map((o) => o.value)).toEqual(
      expect.arrayContaining(['M', 'F']),
    )
  })
})
