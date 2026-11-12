/**
 * Who may be handed a sign-in link for an account. Pure — unit-tested in
 * account-link-policy.test.ts.
 *
 * A Supabase magic link IS a login: whoever holds it is that user. Staff
 * flows (team invite, portal invite, "generate sign-in link") mint these
 * with the service-role client, so the question "should the person at the
 * counter be shown this link?" has to be answered deliberately:
 *
 *   - An account with ANY staff role anywhere, or the platform superadmin,
 *     is never given out. (This was an account-takeover path: point a
 *     customer record, or a team invite, at the owner's or the operator's
 *     email and receive a working login for it.)
 *   - A portal-only account that also has portal access at ANOTHER shop is
 *     only ever emailed to its own address — a link in the operator's hands
 *     would open that customer's data at the other shop.
 *   - A portal-only account whose entire access is this shop's portal, or a
 *     brand-new account that has no access to anything yet, may be handed
 *     to the operator (the in-store assist the feature exists for).
 */

export type AccountAccess = {
  userId: string
  /** profiles.role === 'superadmin' */
  isSuperadmin: boolean
  /** Tenants where the account holds any non-client role (active or not). */
  staffTenantIds: ReadonlyArray<string>
  /** Tenants where the account is a portal client (active or not). */
  clientTenantIds: ReadonlyArray<string>
}

export type LinkHandoff =
  /** The operator may see / copy the link. */
  | 'operator'
  /** Only email it to the account's own address; never show it to staff. */
  | 'email_only'
  /** Do not mint a link for this account at all. */
  | 'refuse'

/**
 * @param access   the account the link would log into — null when no account
 *                 exists yet (a fresh one is about to be created).
 * @param tenantId the shop the operator is acting for.
 */
export function portalLinkHandoff(
  access: AccountAccess | null,
  tenantId: string,
): LinkHandoff {
  if (!access) return 'operator'
  if (access.isSuperadmin || access.staffTenantIds.length > 0) return 'refuse'
  if (access.clientTenantIds.some((t) => t !== tenantId)) return 'email_only'
  return 'operator'
}
