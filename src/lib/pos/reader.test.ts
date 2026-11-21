import { describe, expect, it } from 'vitest'
import { isStripeTestKey, mapStripeBrand, pairReaderSchema, readerChargeState } from './reader'

const PI = 'pi_123'
const busy = { type: 'process_payment_intent', status: 'in_progress', payment_intent: PI }

describe('readerChargeState', () => {
  it('waits while the reader is collecting', () => {
    expect(readerChargeState({ status: 'requires_payment_method' }, busy, PI)).toEqual({ state: 'waiting' })
    expect(readerChargeState({ status: 'processing' }, busy, PI)).toEqual({ state: 'waiting' })
    expect(readerChargeState({ status: 'requires_payment_method' }, null, PI)).toEqual({ state: 'waiting' })
  })
  it('approved on succeeded (automatic capture) or requires_capture', () => {
    expect(readerChargeState({ status: 'succeeded' }, null, PI)).toEqual({ state: 'approved' })
    expect(readerChargeState({ status: 'requires_capture' }, busy, PI)).toEqual({ state: 'approved' })
  })
  it('approval wins even if a stale reader action says failed', () => {
    expect(readerChargeState({ status: 'succeeded' }, { ...busy, status: 'failed' }, PI)).toEqual({ state: 'approved' })
  })
  it('declined when the reader action for THIS intent failed', () => {
    expect(
      readerChargeState({ status: 'requires_payment_method' }, { ...busy, status: 'failed', failure_message: 'Card declined' }, PI),
    ).toEqual({ state: 'declined', message: 'Card declined' })
  })
  it('ignores a failed action that belongs to another intent', () => {
    expect(
      readerChargeState({ status: 'requires_payment_method' }, { ...busy, status: 'failed', payment_intent: 'pi_other' }, PI),
    ).toEqual({ state: 'waiting' })
  })
  it('declined when the intent went back to requires_payment_method with an error', () => {
    expect(
      readerChargeState({ status: 'requires_payment_method', last_payment_error: { message: 'Insufficient funds' } }, null, PI),
    ).toEqual({ state: 'declined', message: 'Insufficient funds' })
  })
  it('canceled', () => {
    expect(readerChargeState({ status: 'canceled' }, null, PI)).toEqual({ state: 'canceled' })
  })
})

describe('mapStripeBrand', () => {
  it('keeps the four brands and folds the rest into other', () => {
    expect(mapStripeBrand('Visa')).toBe('visa')
    expect(mapStripeBrand('american_express')).toBe('amex')
    expect(mapStripeBrand('jcb')).toBe('other')
    expect(mapStripeBrand(null)).toBeNull()
  })
})

describe('isStripeTestKey', () => {
  it('only sk_test_ keys', () => {
    expect(isStripeTestKey('sk_test_abc')).toBe(true)
    expect(isStripeTestKey('sk_live_abc')).toBe(false)
    expect(isStripeTestKey(undefined)).toBe(false)
  })
})

describe('pairReaderSchema', () => {
  it('takes a reader code (lowercased) and a name', () => {
    expect(pairReaderSchema.parse({ registration_code: ' Sepia-Cerulean-Aardvark ', label: ' Front counter ' })).toEqual({
      registration_code: 'sepia-cerulean-aardvark',
      label: 'Front counter',
    })
    expect(pairReaderSchema.parse({ registration_code: 'simulated-wpe', label: 'Test' }).registration_code).toBe('simulated-wpe')
  })
  it('refuses junk codes and a blank name', () => {
    expect(pairReaderSchema.safeParse({ registration_code: 'a b', label: 'x' }).success).toBe(false)
    expect(pairReaderSchema.safeParse({ registration_code: '-abc', label: 'x' }).success).toBe(false)
    expect(pairReaderSchema.safeParse({ registration_code: 'abc', label: '  ' }).success).toBe(false)
  })
})
