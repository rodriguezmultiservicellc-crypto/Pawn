import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signOrocutBody, verifyOrocutSignature } from './signature'

const SECRET = 'ord_test_0123456789abcdef'
const BODY = JSON.stringify({ order_id: 'o_1', external_id: 'RT-000123', status: 'cut', at: '2026-11-09T14:20:00Z' })

describe('verifyOrocutSignature', () => {
  it('accepts the hex digest', () => {
    expect(verifyOrocutSignature(BODY, signOrocutBody(BODY, SECRET), SECRET)).toBe(true)
  })

  it('accepts a base64 digest', () => {
    const b64 = createHmac('sha256', SECRET).update(BODY).digest('base64')
    expect(verifyOrocutSignature(BODY, `sha256=${b64}`, SECRET)).toBe(true)
  })

  it('rejects a wrong secret, a tampered body, and a bad header', () => {
    const sig = signOrocutBody(BODY, SECRET)
    expect(verifyOrocutSignature(BODY, sig, 'ord_other')).toBe(false)
    expect(verifyOrocutSignature(BODY + ' ', sig, SECRET)).toBe(false)
    expect(verifyOrocutSignature(BODY, 'md5=abc', SECRET)).toBe(false)
    expect(verifyOrocutSignature(BODY, 'sha256=zz', SECRET)).toBe(false)
    expect(verifyOrocutSignature(BODY, null, SECRET)).toBe(false)
    expect(verifyOrocutSignature(BODY, sig, '')).toBe(false)
  })
})
