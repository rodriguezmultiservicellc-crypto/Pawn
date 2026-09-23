import { describe, expect, it } from 'vitest'
import { isBrowserRenderableImage, resolveUploadMime } from './mime'

/** Minimal File stand-in — only name + type are read. */
function fakeFile(name: string, type: string): File {
  return { name, type } as File
}

describe('resolveUploadMime', () => {
  it('trusts a recognised declared type', () => {
    expect(resolveUploadMime(fakeFile('a.jpg', 'image/jpeg'))).toBe('image/jpeg')
    expect(resolveUploadMime(fakeFile('a.png', 'image/png'))).toBe('image/png')
    expect(resolveUploadMime(fakeFile('a.pdf', 'application/pdf'))).toBe(
      'application/pdf',
    )
  })

  // THE BUG: Windows has no registered MIME for HEIC, so Chrome hands us an
  // empty string for a perfectly good iPhone photo and the allowlist check
  // rejected it with mime_not_allowed.
  it('falls back to the extension when the browser declares nothing', () => {
    expect(resolveUploadMime(fakeFile('IMG_1234.HEIC', ''))).toBe('image/heic')
    expect(resolveUploadMime(fakeFile('IMG_1234.heic', ''))).toBe('image/heic')
    expect(resolveUploadMime(fakeFile('scan.pdf', ''))).toBe('application/pdf')
    expect(resolveUploadMime(fakeFile('photo.jpg', ''))).toBe('image/jpeg')
  })

  it('normalises the aliases phones and browsers report', () => {
    expect(resolveUploadMime(fakeFile('a.heic', 'image/heif'))).toBe('image/heic')
    expect(resolveUploadMime(fakeFile('a.jpg', 'image/jpg'))).toBe('image/jpeg')
    expect(resolveUploadMime(fakeFile('a.heic', 'IMAGE/HEIC'))).toBe('image/heic')
    expect(resolveUploadMime(fakeFile('a.heic', 'image/heic-sequence'))).toBe(
      'image/heic',
    )
  })

  it('prefers the extension when the declared type is unrecognised', () => {
    // Windows sometimes reports a generic or wrong type for HEIC.
    expect(resolveUploadMime(fakeFile('IMG_1.HEIC', 'application/octet-stream')))
      .toBe('image/heic')
  })

  it('returns something the allowlist will reject for unknown files', () => {
    // Must NOT invent an allowed type — the gate is the caller's allowlist.
    expect(resolveUploadMime(fakeFile('virus.exe', ''))).toBe('')
    expect(resolveUploadMime(fakeFile('notes.txt', 'text/plain'))).toBe(
      'text/plain',
    )
    expect(resolveUploadMime(fakeFile('noext', ''))).toBe('')
  })

  it('handles a filename with no extension or a trailing dot', () => {
    expect(resolveUploadMime(fakeFile('archive.', ''))).toBe('')
    expect(resolveUploadMime(fakeFile('', ''))).toBe('')
  })
})

describe('isBrowserRenderableImage', () => {
  // HEIC is the reason this exists: Safari paints it, Chrome/Edge/Firefox do
  // not, so an <img> on a shop machine renders broken.
  it('rejects HEIC and its aliases', () => {
    expect(isBrowserRenderableImage('image/heic')).toBe(false)
    expect(isBrowserRenderableImage('image/heif')).toBe(false)
    expect(isBrowserRenderableImage('IMAGE/HEIC')).toBe(false)
  })

  it('accepts the formats every browser paints', () => {
    expect(isBrowserRenderableImage('image/jpeg')).toBe(true)
    expect(isBrowserRenderableImage('image/png')).toBe(true)
    expect(isBrowserRenderableImage('image/webp')).toBe(true)
  })

  it('rejects non-images and blanks', () => {
    expect(isBrowserRenderableImage('application/pdf')).toBe(false)
    expect(isBrowserRenderableImage(null)).toBe(false)
    expect(isBrowserRenderableImage('')).toBe(false)
  })
})
