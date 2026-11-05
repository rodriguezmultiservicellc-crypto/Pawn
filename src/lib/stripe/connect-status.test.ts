// src/lib/stripe/connect-status.test.ts
import { describe, it, expect } from 'vitest'
import {
  accountIdSuffix,
  billingPatchFromAccount,
  buildAccountLinkUrls,
  buildSettingsRedirect,
  deriveConnectStatus,
  flagForStatus,
  normalizeAppUrl,
} from './connect-status'

describe('deriveConnectStatus', () => {
  it('is not_connected without an account id', () => {
    expect(deriveConnectStatus({ stripeAccountId: null })).toBe('not_connected')
    expect(deriveConnectStatus({ stripeAccountId: '' })).toBe('not_connected')
    expect(
      deriveConnectStatus({
        stripeAccountId: undefined,
        chargesEnabled: true,
        detailsSubmitted: true,
      }),
    ).toBe('not_connected')
  })

  it('is onboarding_incomplete when an account exists but charges are off', () => {
    expect(deriveConnectStatus({ stripeAccountId: 'acct_1' })).toBe(
      'onboarding_incomplete',
    )
    expect(
      deriveConnectStatus({
        stripeAccountId: 'acct_1',
        detailsSubmitted: true,
        chargesEnabled: false,
      }),
    ).toBe('onboarding_incomplete')
    // Charges on but details not submitted should not happen on Stripe's
    // side, but we still refuse to call it connected.
    expect(
      deriveConnectStatus({
        stripeAccountId: 'acct_1',
        detailsSubmitted: false,
        chargesEnabled: true,
      }),
    ).toBe('onboarding_incomplete')
  })

  it('is connected when details are submitted and charges are enabled', () => {
    expect(
      deriveConnectStatus({
        stripeAccountId: 'acct_1',
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: false,
      }),
    ).toBe('connected')
  })

  it('does not require payouts to be enabled', () => {
    expect(
      deriveConnectStatus({
        stripeAccountId: 'acct_1',
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: null,
      }),
    ).toBe('connected')
  })
})

describe('accountIdSuffix', () => {
  it('returns the last 4 characters', () => {
    expect(accountIdSuffix('acct_1NvXyz8Q2k')).toBe('8Q2k')
  })
  it('returns null for empty input', () => {
    expect(accountIdSuffix(null)).toBeNull()
    expect(accountIdSuffix(undefined)).toBeNull()
    expect(accountIdSuffix('')).toBeNull()
  })
  it('honors a custom length', () => {
    expect(accountIdSuffix('acct_1NvXyz8Q2k', 6)).toBe('yz8Q2k')
  })
})

describe('normalizeAppUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeAppUrl('http://localhost:3060/')).toBe(
      'http://localhost:3060',
    )
    expect(normalizeAppUrl('https://app.example.com//')).toBe(
      'https://app.example.com',
    )
  })
  it('throws when missing', () => {
    expect(() => normalizeAppUrl(undefined)).toThrow(
      'next_public_app_url_missing',
    )
    expect(() => normalizeAppUrl('  ')).toThrow('next_public_app_url_missing')
  })
})

describe('buildAccountLinkUrls', () => {
  it('points return at the callback and refresh at start', () => {
    expect(buildAccountLinkUrls('http://localhost:3060/')).toEqual({
      returnUrl: 'http://localhost:3060/api/stripe/connect/callback',
      refreshUrl: 'http://localhost:3060/api/stripe/connect/start',
    })
  })
})

describe('buildSettingsRedirect', () => {
  it('lands on settings/integrations with the stripe flag', () => {
    expect(buildSettingsRedirect('https://pawn.example.com', 'connected')).toBe(
      'https://pawn.example.com/settings/integrations?stripe=connected',
    )
  })
})

describe('flagForStatus', () => {
  it('maps every status to a redirect flag', () => {
    expect(flagForStatus('connected')).toBe('connected')
    expect(flagForStatus('onboarding_incomplete')).toBe('incomplete')
    expect(flagForStatus('not_connected')).toBe('not_connected')
  })
})

describe('billingPatchFromAccount', () => {
  const now = new Date('2026-11-04T15:00:00.000Z')

  it('mirrors the three flags and sets billing_enabled from charges', () => {
    const patch = billingPatchFromAccount(
      {
        id: 'acct_1',
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      },
      { now, existingConnectedAt: null },
    )
    expect(patch.stripe_charges_enabled).toBe(true)
    expect(patch.stripe_payouts_enabled).toBe(false)
    expect(patch.stripe_details_submitted).toBe(true)
    expect(patch.billing_enabled).toBe(true)
    expect(patch.stripe_status_synced_at).toBe(now.toISOString())
  })

  it('stamps stripe_connected_at the first time the account goes live', () => {
    const patch = billingPatchFromAccount(
      { id: 'acct_1', charges_enabled: true, details_submitted: true },
      { now, existingConnectedAt: null },
    )
    expect(patch.stripe_connected_at).toBe(now.toISOString())
  })

  it('never overwrites an existing stripe_connected_at', () => {
    const patch = billingPatchFromAccount(
      { id: 'acct_1', charges_enabled: true, details_submitted: true },
      { now, existingConnectedAt: '2026-01-01T00:00:00.000Z' },
    )
    expect(patch).not.toHaveProperty('stripe_connected_at')
  })

  it('does not stamp stripe_connected_at while onboarding is incomplete', () => {
    const patch = billingPatchFromAccount(
      { id: 'acct_1', charges_enabled: false, details_submitted: true },
      { now, existingConnectedAt: null },
    )
    expect(patch).not.toHaveProperty('stripe_connected_at')
    expect(patch.billing_enabled).toBe(false)
  })

  it('treats null / undefined flags as false', () => {
    const patch = billingPatchFromAccount(
      { id: 'acct_1', charges_enabled: null, payouts_enabled: undefined },
      { now, existingConnectedAt: null },
    )
    expect(patch.stripe_charges_enabled).toBe(false)
    expect(patch.stripe_payouts_enabled).toBe(false)
    expect(patch.stripe_details_submitted).toBe(false)
  })
})
