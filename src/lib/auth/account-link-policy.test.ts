import { describe, expect, it } from 'vitest'
import { portalLinkHandoff, type AccountAccess } from './account-link-policy'

const SHOP = 'tenant-here'
const OTHER = 'tenant-other'

function account(over: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: 'user-1',
    isSuperadmin: false,
    staffTenantIds: [],
    clientTenantIds: [],
    ...over,
  }
}

describe('portalLinkHandoff', () => {
  it('no account yet → the operator may hold the new invite link', () => {
    expect(portalLinkHandoff(null, SHOP)).toBe('operator')
  })

  it('never hands out the platform superadmin', () => {
    expect(portalLinkHandoff(account({ isSuperadmin: true }), SHOP)).toBe('refuse')
  })

  it('never hands out an account with a staff role — here or anywhere', () => {
    expect(portalLinkHandoff(account({ staffTenantIds: [SHOP] }), SHOP)).toBe('refuse')
    expect(portalLinkHandoff(account({ staffTenantIds: [OTHER] }), SHOP)).toBe('refuse')
    // Staff somewhere AND a portal client here is still staff.
    expect(
      portalLinkHandoff(
        account({ staffTenantIds: [OTHER], clientTenantIds: [SHOP] }),
        SHOP,
      ),
    ).toBe('refuse')
  })

  it('a portal client of another shop is email-only', () => {
    expect(portalLinkHandoff(account({ clientTenantIds: [OTHER] }), SHOP)).toBe('email_only')
    expect(
      portalLinkHandoff(account({ clientTenantIds: [SHOP, OTHER] }), SHOP),
    ).toBe('email_only')
  })

  it('a portal client of this shop only may be handed to the operator', () => {
    expect(portalLinkHandoff(account({ clientTenantIds: [SHOP] }), SHOP)).toBe('operator')
  })

  it('an existing account with no access to anything may be handed over', () => {
    // e.g. created by an earlier invite that was never claimed.
    expect(portalLinkHandoff(account(), SHOP)).toBe('operator')
  })
})
