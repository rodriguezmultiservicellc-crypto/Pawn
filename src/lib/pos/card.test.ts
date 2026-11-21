import { describe, expect, it } from 'vitest'
import { cardSummary, cleanAuthCode, cleanLast4, externalCardSchema } from './card'

describe('externalCardSchema', () => {
  it('accepts 4 digits, a known brand and an optional approval code (uppercased)', () => {
    expect(externalCardSchema.parse({ last4: ' 4242 ', brand: 'visa', auth_code: ' ab12 ' })).toEqual({
      last4: '4242',
      brand: 'visa',
      auth_code: 'AB12',
    })
    expect(externalCardSchema.parse({ last4: '0005', brand: 'amex' }).auth_code).toBeNull()
    expect(externalCardSchema.parse({ last4: '0005', brand: 'amex', auth_code: '' }).auth_code).toBeNull()
  })
  it('refuses a wrong last 4, an unknown brand and a bad approval code', () => {
    expect(externalCardSchema.safeParse({ last4: '424', brand: 'visa' }).success).toBe(false)
    expect(externalCardSchema.safeParse({ last4: '42a2', brand: 'visa' }).success).toBe(false)
    expect(externalCardSchema.safeParse({ last4: '4242', brand: 'diners' }).success).toBe(false)
    expect(externalCardSchema.safeParse({ last4: '4242', brand: 'visa', auth_code: 'AB-12' }).success).toBe(false)
    expect(externalCardSchema.safeParse({ last4: '4242', brand: 'visa', auth_code: 'A'.repeat(13) }).success).toBe(false)
  })
})

describe('input cleaners', () => {
  it('last 4 keeps digits only, the last four', () => {
    expect(cleanLast4('42a4x2')).toBe('4242')
    expect(cleanLast4('**** **** **** 4242')).toBe('4242')
    expect(cleanLast4('x')).toBe('')
  })
  it('approval code keeps letters and digits, uppercase, max 12', () => {
    expect(cleanAuthCode('ab-12 c')).toBe('AB12C')
    expect(cleanAuthCode('1234567890ABCDEF')).toBe('1234567890AB')
  })
})

describe('cardSummary', () => {
  const label = (b: string) => b.toUpperCase()
  it('brand, masked last 4 and approval code', () => {
    expect(cardSummary({ card_brand: 'visa', card_last4: '4242', card_auth_code: 'AB12' }, label, 'Auth')).toBe(
      'VISA •••• 4242 · Auth AB12',
    )
    expect(cardSummary({ card_brand: null, card_last4: '0005', card_auth_code: null }, label, 'Auth')).toBe('•••• 0005')
  })
  it('null without a last 4 (reader rows, cash)', () => {
    expect(cardSummary({ card_last4: null }, label, 'Auth')).toBeNull()
  })
})
