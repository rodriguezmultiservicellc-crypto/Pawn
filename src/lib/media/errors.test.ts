import { describe, expect, it } from 'vitest'
import {
  classifyMediaError,
  mediaErrorMessage,
  mediaErrorName,
  type MediaErrorKind,
} from './errors'

/** DOMException stand-in — only `name` is read. */
function domError(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

const MESSAGES: Record<MediaErrorKind, string> = {
  denied: 'blocked',
  inUse: 'busy',
  notFound: 'missing',
  constraints: 'constraints',
  insecure: 'https',
  unknown: 'unknown',
}

describe('classifyMediaError', () => {
  // The bug that started this: NotReadableError was being reported as a
  // permissions problem, sending the operator to the one setting that was
  // already correct.
  it('treats NotReadableError as a busy device, NOT a permission problem', () => {
    expect(classifyMediaError(domError('NotReadableError'))).toBe('inUse')
    expect(classifyMediaError(domError('TrackStartError'))).toBe('inUse')
  })

  it('maps permission failures', () => {
    expect(classifyMediaError(domError('NotAllowedError'))).toBe('denied')
    expect(classifyMediaError(domError('PermissionDeniedError'))).toBe('denied')
  })

  it('maps missing hardware', () => {
    expect(classifyMediaError(domError('NotFoundError'))).toBe('notFound')
    expect(classifyMediaError(domError('DevicesNotFoundError'))).toBe('notFound')
  })

  it('maps constraint and secure-context failures', () => {
    expect(classifyMediaError(domError('OverconstrainedError'))).toBe('constraints')
    expect(classifyMediaError(domError('ConstraintNotSatisfiedError'))).toBe('constraints')
    expect(classifyMediaError(domError('SecurityError'))).toBe('insecure')
  })

  it('falls back to unknown for anything unrecognised', () => {
    expect(classifyMediaError(domError('AbortError'))).toBe('unknown')
    expect(classifyMediaError(domError('WeirdFutureError'))).toBe('unknown')
    expect(classifyMediaError(new Error('plain'))).toBe('unknown')
    expect(classifyMediaError('a string')).toBe('unknown')
    expect(classifyMediaError(null)).toBe('unknown')
    expect(classifyMediaError(undefined)).toBe('unknown')
  })
})

describe('mediaErrorName', () => {
  it('reads the DOMException name, or empty when there is none', () => {
    expect(mediaErrorName(domError('NotReadableError'))).toBe('NotReadableError')
    expect(mediaErrorName('nope')).toBe('')
    expect(mediaErrorName(null)).toBe('')
  })
})

describe('mediaErrorMessage', () => {
  it('pairs the right advice with the raw name for support', () => {
    expect(mediaErrorMessage(domError('NotReadableError'), MESSAGES)).toBe(
      'busy (NotReadableError)',
    )
    expect(mediaErrorMessage(domError('NotAllowedError'), MESSAGES)).toBe(
      'blocked (NotAllowedError)',
    )
  })

  it('omits the suffix when there is no error name', () => {
    expect(mediaErrorMessage('boom', MESSAGES)).toBe('unknown')
  })
})
