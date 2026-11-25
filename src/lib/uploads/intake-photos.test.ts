import { describe, expect, it } from 'vitest'
import {
  INTAKE_PHOTO_MAX,
  allPhotoPaths,
  intakePhotoMime,
  intakePhotoPath,
  parseIntakePhotoPaths,
} from './intake-photos'

const T = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-2222-3333-4444-555555555555'
const p = (n: number, ext = 'jpg', tenant = T) =>
  `${tenant}/intake/${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd.${ext}`

describe('intakePhotoPath', () => {
  it("is in the shop's intake folder and passes the parser", () => {
    const path = intakePhotoPath(T, 'jpg')
    expect(path.startsWith(`${T}/intake/`)).toBe(true)
    expect(parseIntakePhotoPaths([path], T)).toEqual([path])
  })

  it('falls back to jpg for an extension that is not a photo', () => {
    expect(intakePhotoPath(T, 'exe').endsWith('.jpg')).toBe(true)
  })
})

describe('parseIntakePhotoPaths', () => {
  it('nothing sent is no photos', () => {
    expect(parseIntakePhotoPaths(null, T)).toEqual([])
    expect(parseIntakePhotoPaths('', T)).toEqual([])
    expect(parseIntakePhotoPaths('[]', T)).toEqual([])
  })

  it('keeps the order (main first) and drops a repeat', () => {
    expect(parseIntakePhotoPaths(JSON.stringify([p(2), p(1), p(2)]), T)).toEqual([p(2), p(1)])
  })

  it('takes every photo kind the browser stores', () => {
    const list = [p(1, 'jpg'), p(2, 'png'), p(3, 'webp'), p(4, 'heic'), p(5, 'jpeg')]
    expect(parseIntakePhotoPaths(list, T)).toEqual(list)
  })

  it("refuses another shop's photo", () => {
    expect(parseIntakePhotoPaths([p(1), p(2, 'jpg', OTHER)], T)).toBeNull()
  })

  it('refuses a path outside the intake folder or a made-up one', () => {
    expect(parseIntakePhotoPaths([`${T}/loans/x/photo.jpg`], T)).toBeNull()
    expect(parseIntakePhotoPaths([`${T}/intake/../${OTHER}/intake/a.jpg`], T)).toBeNull()
    expect(parseIntakePhotoPaths([p(1, 'pdf')], T)).toBeNull()
  })

  it('refuses what is not a list of strings', () => {
    expect(parseIntakePhotoPaths('not json', T)).toBeNull()
    expect(parseIntakePhotoPaths('{"a":1}', T)).toBeNull()
    expect(parseIntakePhotoPaths([1, 2], T)).toBeNull()
  })

  it(`refuses more than ${INTAKE_PHOTO_MAX} photos`, () => {
    const max = Array.from({ length: INTAKE_PHOTO_MAX }, (_, i) => p(i + 1))
    expect(parseIntakePhotoPaths(max, T)).toHaveLength(INTAKE_PHOTO_MAX)
    expect(parseIntakePhotoPaths([...max, p(99)], T)).toBeNull()
  })
})

describe('allPhotoPaths', () => {
  it('main photo first, then the rest', () => {
    expect(allPhotoPaths({ photo_path: 'a', extra_photo_paths: ['b', 'c'] })).toEqual(['a', 'b', 'c'])
  })

  it('an item with no photo, or from before extra photos', () => {
    expect(allPhotoPaths({ photo_path: null, extra_photo_paths: [] })).toEqual([])
    expect(allPhotoPaths({ photo_path: 'a' })).toEqual(['a'])
  })
})

describe('intakePhotoMime', () => {
  it('reads the extension', () => {
    expect(intakePhotoMime('x/intake/a.png')).toBe('image/png')
    expect(intakePhotoMime('x/intake/a.webp')).toBe('image/webp')
    expect(intakePhotoMime('x/intake/a.heic')).toBe('image/heic')
    expect(intakePhotoMime('x/intake/a.jpg')).toBe('image/jpeg')
    expect(intakePhotoMime('x/intake/a.jpeg')).toBe('image/jpeg')
  })
})
