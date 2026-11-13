import { describe, expect, it } from 'vitest'
import { cleanDomainInput, isAppHost, normalizeHost, verificationRecordName } from './custom-domain'

const env = { appUrl: 'https://pawn-three.vercel.app', baseDomain: 'solpawn.com' }

describe('normalizeHost', () => {
  it('lowercases and strips port and trailing dot', () => {
    expect(normalizeHost('Shop.Example.COM:443')).toBe('shop.example.com')
    expect(normalizeHost('shop.example.com.')).toBe('shop.example.com')
    expect(normalizeHost(null)).toBe('')
  })
})

describe('isAppHost', () => {
  it('treats the app, previews, localhost and the base domain as the app', () => {
    expect(isAppHost('localhost', env)).toBe(true)
    expect(isAppHost('127.0.0.1', env)).toBe(true)
    expect(isAppHost('pawn-git-main-rms.vercel.app', env)).toBe(true)
    expect(isAppHost('solpawn.com', env)).toBe(true)
    expect(isAppHost('eddys.solpawn.com', env)).toBe(true)
  })
  it("treats anything else as a shop's own domain", () => {
    expect(isAppHost('shop.eddysjewelers.com', env)).toBe(false)
    expect(isAppHost('notsolpawn.com', env)).toBe(false)
  })
})

describe('cleanDomainInput', () => {
  it('accepts what owners paste', () => {
    expect(cleanDomainInput('https://Shop.Example.com/catalog')).toBe('shop.example.com')
    expect(cleanDomainInput(' example.co.uk ')).toBe('example.co.uk')
  })
  it('rejects non-domains', () => {
    expect(cleanDomainInput('localhost')).toBeNull()
    expect(cleanDomainInput('bad_domain.com')).toBeNull()
    expect(cleanDomainInput('')).toBeNull()
  })
  it('names the TXT record', () => {
    expect(verificationRecordName('shop.example.com')).toBe('_solpawn.shop.example.com')
  })
})
