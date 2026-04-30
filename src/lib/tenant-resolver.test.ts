/**
 * Pure-helper tests for the public-tenant resolver.
 *
 * The resolver runs in two contexts: extractTenantSubdomain in the proxy
 * (edge runtime, every request) and isReservedOrInvalidSlug in the
 * settings save action. Both are pure and don't hit the DB — vitest
 * exercises them directly per the Session 13 convention (no Supabase
 * mocks, only pure-logic tests).
 *
 * fetchPublicTenant is integration territory (it talks to the live
 * Supabase project's RLS gate) and is intentionally NOT covered here.
 * Manual smoke testing covers it: set public_landing_enabled=FALSE and
 * confirm /s/<slug> returns 404; flip it TRUE and confirm it renders.
 *
 * Pinned behaviors:
 *
 *   1. extractTenantSubdomain returns the slug for a single-level
 *      tenant subdomain matching the configured base domain.
 *   2. The function is null for: apex, missing baseDomain, missing host,
 *      reserved subdomain, multi-level subdomain, malformed slug,
 *      port-only host, host that doesn't end in baseDomain.
 *   3. Case + whitespace normalize: input is lowercased and trimmed
 *      before comparison so `Acme.Pawnshop.com` and `acme.pawnshop.com`
 *      resolve identically.
 *   4. isReservedOrInvalidSlug rejects: reserved names, too-short,
 *      too-long, leading/trailing hyphens, consecutive hyphens, and
 *      uppercase/non-URL-safe characters. It accepts well-formed
 *      slugs of various lengths.
 */

import { describe, expect, it } from 'vitest'
import {
  extractTenantSubdomain,
  isReservedOrInvalidSlug,
} from './tenant-resolver'

// ── extractTenantSubdomain ─────────────────────────────────────────────

describe('extractTenantSubdomain', () => {
  const BASE = 'pawnshop.com'

  it('extracts a tenant slug from a single-level subdomain', () => {
    expect(extractTenantSubdomain('acme.pawnshop.com', BASE)).toBe('acme')
  })

  it('strips the port and lowercases the host', () => {
    expect(extractTenantSubdomain('Acme.PawnShop.com:3060', BASE)).toBe('acme')
  })

  it('returns null on the apex domain (no subdomain)', () => {
    expect(extractTenantSubdomain('pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('pawnshop.com:3060', BASE)).toBeNull()
  })

  it('returns null when the host does not end with the base domain', () => {
    expect(extractTenantSubdomain('acme.example.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('acmepawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('localhost:3060', BASE)).toBeNull()
  })

  it('returns null when the base domain is unset (local dev pre-DNS)', () => {
    expect(extractTenantSubdomain('acme.pawnshop.com', undefined)).toBeNull()
    expect(extractTenantSubdomain('acme.pawnshop.com', null)).toBeNull()
    expect(extractTenantSubdomain('acme.pawnshop.com', '')).toBeNull()
  })

  it('rejects multi-level subdomains', () => {
    expect(extractTenantSubdomain('acme.b.pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('a.b.c.pawnshop.com', BASE)).toBeNull()
  })

  it('rejects platform-reserved subdomains', () => {
    expect(extractTenantSubdomain('www.pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('admin.pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('api.pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('app.pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('portal.pawnshop.com', BASE)).toBeNull()
    expect(extractTenantSubdomain('staff.pawnshop.com', BASE)).toBeNull()
  })

  it('rejects malformed slugs (uppercase, leading/trailing hyphen, etc.)', () => {
    // All-uppercase subdomain — after lowercasing it'd match the regex,
    // so this case actually passes through. Confirms case-folding works:
    expect(extractTenantSubdomain('ACME.pawnshop.com', BASE)).toBe('acme')
    // Leading hyphen — regex rejects.
    expect(extractTenantSubdomain('-acme.pawnshop.com', BASE)).toBeNull()
    // Trailing hyphen — regex rejects.
    expect(extractTenantSubdomain('acme-.pawnshop.com', BASE)).toBeNull()
    // Empty subdomain (`.pawnshop.com`).
    expect(extractTenantSubdomain('.pawnshop.com', BASE)).toBeNull()
    // Underscore — not URL-safe per our slug rules.
    expect(extractTenantSubdomain('a_b.pawnshop.com', BASE)).toBeNull()
  })

  it('handles a staging-style multi-segment base domain', () => {
    expect(
      extractTenantSubdomain('acme.staging.pawnshop.com', 'staging.pawnshop.com'),
    ).toBe('acme')
    expect(
      extractTenantSubdomain('acme.pawnshop.com', 'staging.pawnshop.com'),
    ).toBeNull()
  })

  it('handles base domain with a leading dot (defensive normalization)', () => {
    expect(extractTenantSubdomain('acme.pawnshop.com', '.pawnshop.com')).toBe(
      'acme',
    )
  })

  it('null/empty host short-circuits to null', () => {
    expect(extractTenantSubdomain(null, BASE)).toBeNull()
    expect(extractTenantSubdomain(undefined, BASE)).toBeNull()
    expect(extractTenantSubdomain('', BASE)).toBeNull()
  })
})

// ── isReservedOrInvalidSlug ────────────────────────────────────────────

describe('isReservedOrInvalidSlug', () => {
  it('accepts well-formed slugs across the allowed length range', () => {
    expect(isReservedOrInvalidSlug('acme')).toBe(false)
    expect(isReservedOrInvalidSlug('main-st-pawn')).toBe(false)
    expect(isReservedOrInvalidSlug('shop-12')).toBe(false)
    expect(isReservedOrInvalidSlug('123')).toBe(false) // digits-only OK
    expect(isReservedOrInvalidSlug('a1b')).toBe(false) // 3-char min
    expect(isReservedOrInvalidSlug('a'.repeat(40))).toBe(false) // 40-char max
  })

  it('rejects slugs that are too short or too long', () => {
    expect(isReservedOrInvalidSlug('')).toBe(true)
    expect(isReservedOrInvalidSlug('a')).toBe(true)
    expect(isReservedOrInvalidSlug('ab')).toBe(true)
    expect(isReservedOrInvalidSlug('a'.repeat(41))).toBe(true)
  })

  it('rejects malformed slugs (case, leading/trailing hyphen, consecutive hyphens)', () => {
    expect(isReservedOrInvalidSlug('Acme')).toBe(true) // uppercase
    expect(isReservedOrInvalidSlug('-acme')).toBe(true) // leading hyphen
    expect(isReservedOrInvalidSlug('acme-')).toBe(true) // trailing hyphen
    expect(isReservedOrInvalidSlug('a--b')).toBe(true) // consecutive hyphens
    expect(isReservedOrInvalidSlug('a_b')).toBe(true) // underscore
    expect(isReservedOrInvalidSlug('a b')).toBe(true) // space
    expect(isReservedOrInvalidSlug('a.b')).toBe(true) // dot
  })

  it('rejects platform-reserved slugs', () => {
    expect(isReservedOrInvalidSlug('admin')).toBe(true)
    expect(isReservedOrInvalidSlug('api')).toBe(true)
    expect(isReservedOrInvalidSlug('www')).toBe(true)
    expect(isReservedOrInvalidSlug('portal')).toBe(true)
    expect(isReservedOrInvalidSlug('staff')).toBe(true)
    expect(isReservedOrInvalidSlug('settings')).toBe(true)
    expect(isReservedOrInvalidSlug('billing')).toBe(true)
  })
})
