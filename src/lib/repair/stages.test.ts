import { describe, expect, it } from 'vitest'
import {
  isValidPublicToken,
  nextStage,
  progressPercent,
  stageIndex,
  stageName,
  trackingUrl,
} from './stages'

const STAGES = [
  { id: 'c', name_en: 'Casting', name_es: 'Fundición', percent: 40, sort_order: 40 },
  { id: 'a', name_en: 'Received', name_es: 'Recibido', percent: 10, sort_order: 10 },
  { id: 'b', name_en: 'In progress', name_es: 'En proceso', percent: 60, sort_order: 20 },
]

describe('nextStage', () => {
  it('walks in sort order, not array order', () => {
    expect(nextStage(STAGES, 'a')?.id).toBe('b')
    expect(nextStage(STAGES, 'b')?.id).toBe('c')
  })
  it('returns null at the last stage', () => {
    expect(nextStage(STAGES, 'c')).toBeNull()
  })
  it('starts at the first stage when none is set or the id is unknown', () => {
    expect(nextStage(STAGES, null)?.id).toBe('a')
    expect(nextStage(STAGES, 'zzz')?.id).toBe('a')
  })
  it('returns null when a tenant has no stages configured', () => {
    expect(nextStage([], null)).toBeNull()
  })
})

describe('stageIndex / stageName / progressPercent', () => {
  it('indexes by sorted position', () => {
    expect(stageIndex(STAGES, 'c')).toBe(2)
    expect(stageIndex(STAGES, null)).toBe(-1)
  })
  it('picks the language', () => {
    expect(stageName(STAGES[0], 'en')).toBe('Casting')
    expect(stageName(STAGES[0], 'es')).toBe('Fundición')
  })
  it('clamps the bar', () => {
    expect(progressPercent(null)).toBe(0)
    expect(progressPercent({ percent: 60 })).toBe(60)
    expect(progressPercent({ percent: 140 })).toBe(100)
    expect(progressPercent({ percent: -5 })).toBe(0)
  })
})

describe('public token + URL', () => {
  const TOKEN = '0123456789abcdef0123456789abcdef'
  it('accepts exactly one dashless UUID', () => {
    expect(isValidPublicToken(TOKEN)).toBe(true)
    expect(isValidPublicToken(TOKEN.toUpperCase())).toBe(false)
    expect(isValidPublicToken(TOKEN.slice(1))).toBe(false)
    expect(isValidPublicToken('RT-000123')).toBe(false)
    expect(isValidPublicToken(null)).toBe(false)
  })
  it('builds the short /t/ URL and never leaks a ticket number or customer id into it', () => {
    const url = trackingUrl(TOKEN, 'https://pawn-three.vercel.app/')
    expect(url).toBe(`https://pawn-three.vercel.app/t/${TOKEN}`)
    expect(url).not.toMatch(/RT-|customer/i)
  })
  it('is null for a revoked (null) or malformed token', () => {
    expect(trackingUrl(null, 'https://x')).toBeNull()
    expect(trackingUrl('nope', 'https://x')).toBeNull()
  })
})
