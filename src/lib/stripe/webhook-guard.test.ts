import { describe, expect, it } from 'vitest'
import { authorizeLinkEvent, webhookSecretOrNull } from './webhook-guard'

const link = { tenant_id: 'tenant-a', stripe_account_id: 'acct_A' }

describe('authorizeLinkEvent', () => {
  it('accepts an event from the link tenant’s own connected account', () => {
    expect(
      authorizeLinkEvent({ link, eventAccount: 'acct_A', accountTenantId: 'tenant-a' }),
    ).toEqual({ ok: true })
  })

  it('accepts when the link did not record an account id', () => {
    expect(
      authorizeLinkEvent({
        link: { tenant_id: 'tenant-a', stripe_account_id: null },
        eventAccount: 'acct_A',
        accountTenantId: 'tenant-a',
      }),
    ).toEqual({ ok: true })
  })

  it('refuses when we never wrote a link row (metadata is not trusted)', () => {
    expect(
      authorizeLinkEvent({ link: null, eventAccount: 'acct_A', accountTenantId: 'tenant-a' }),
    ).toEqual({ ok: false, reason: 'no_link' })
  })

  it('refuses an event with no connected account', () => {
    expect(
      authorizeLinkEvent({ link, eventAccount: undefined, accountTenantId: null }),
    ).toEqual({ ok: false, reason: 'no_account' })
  })

  it('refuses an account we do not know', () => {
    expect(
      authorizeLinkEvent({ link, eventAccount: 'acct_X', accountTenantId: null }),
    ).toEqual({ ok: false, reason: 'unknown_account' })
  })

  it('refuses another tenant’s account paying this tenant’s link', () => {
    expect(
      authorizeLinkEvent({ link, eventAccount: 'acct_B', accountTenantId: 'tenant-b' }),
    ).toEqual({ ok: false, reason: 'account_tenant_mismatch' })
  })

  it('refuses when the tenant matches but the account differs from the one the session was created on', () => {
    expect(
      authorizeLinkEvent({ link, eventAccount: 'acct_A2', accountTenantId: 'tenant-a' }),
    ).toEqual({ ok: false, reason: 'account_link_mismatch' })
  })
})

describe('webhookSecretOrNull', () => {
  it('returns the secret when set, null when missing or blank', () => {
    expect(webhookSecretOrNull({ STRIPE_WEBHOOK_SECRET: 'whsec_abc' })).toBe('whsec_abc')
    expect(webhookSecretOrNull({})).toBeNull()
    expect(webhookSecretOrNull({ STRIPE_WEBHOOK_SECRET: '   ' })).toBeNull()
  })
})
