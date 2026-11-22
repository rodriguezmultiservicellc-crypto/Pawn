import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phone'
import { customerCreateSchema } from '@/lib/validations/customer'

describe('normalizePhone', () => {
  it('stores a 10-digit number the way existing records are stored', () => {
    for (const typed of ['8135550100', '813-555-0100', '(813) 555-0100', '813.555.0100', ' 813 555 0100 ']) {
      expect(normalizePhone(typed)).toBe('(813) 555-0100')
    }
  })

  it('drops a leading 1 from an 11-digit US number', () => {
    expect(normalizePhone('1 813 555 0100')).toBe('(813) 555-0100')
    expect(normalizePhone('+1 (813) 555-0100')).toBe('(813) 555-0100')
  })

  it('keeps an international number as typed', () => {
    expect(normalizePhone('+53 5 2345678')).toBe('+53 5 2345678')
    expect(normalizePhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
  })

  it('refuses letters, too few digits and too many digits', () => {
    for (const typed of ['dfdd', '813-555-01OO', 'call me', '12345', '1234567890123456', '555-0100 ext 4', '()-']) {
      expect(normalizePhone(typed)).toBeNull()
    }
  })
})

describe('customerCreateSchema — phone and email', () => {
  const base = { first_name: 'Ana', last_name: 'Perez' }
  const codes = (input: Record<string, unknown>) => {
    const r = customerCreateSchema.safeParse({ ...base, ...input })
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
  }

  it('refuses junk with a code the forms can translate', () => {
    expect(codes({ phone: 'dfdd', email: 'fds' })).toEqual({ phone: 'invalid_phone', email: 'invalid_email' })
    expect(codes({ phone_alt: 'abc' })).toEqual({ phone_alt: 'invalid_phone' })
  })

  it('normalises a good phone and leaves blanks empty', () => {
    const r = customerCreateSchema.parse({ ...base, phone: '8135550100', phone_alt: '', email: '' })
    expect(r.phone).toBe('(813) 555-0100')
    expect(r.phone_alt).toBeNull()
    expect(r.email).toBeNull()
  })
})
