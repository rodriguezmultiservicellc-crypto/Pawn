import { describe, expect, it } from 'vitest'
import { appendWorkPhrase } from './work-presets'

describe('appendWorkPhrase', () => {
  it('starts the text with the phrase', () => {
    expect(appendWorkPhrase('', 'Replace clasp')).toEqual({ text: 'Replace clasp', blank: null })
  })

  it('adds a phrase on its own line, dropping trailing blank space', () => {
    expect(appendWorkPhrase('Clean and polish \n\n', 'Replace clasp').text).toBe(
      'Clean and polish\nReplace clasp',
    )
  })

  it('points at the "#" to fill in', () => {
    const r = appendWorkPhrase('Clean', 'Size ring up to #')
    expect(r.text).toBe('Clean\nSize ring up to #')
    expect(r.blank).not.toBeNull()
    const [s, e] = r.blank!
    expect(r.text.slice(s, e)).toBe('#')
  })
})
