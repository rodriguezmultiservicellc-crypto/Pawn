/**
 * Authorization rules for the Connect webhook (src/app/api/stripe/webhook).
 * Pure — unit-tested in webhook-guard.test.ts.
 *
 * A signed event proves it came from Stripe. It does NOT prove it belongs to
 * the tenant it names: the endpoint is a Connect webhook, so every connected
 * account's events arrive here signed with the same secret, and the metadata
 * on a Checkout Session is written by whoever created the session. Money is
 * therefore only ever applied when BOTH hold:
 *
 *   1. our own stripe_payment_links row exists for the session (we wrote it
 *      server-side when we created the session — nobody else can), and
 *   2. the connected account the event came from is the one that belongs to
 *      the link's tenant.
 *
 * Event metadata is never used to decide which loan or layaway gets paid.
 */

export type LinkEventRefusal =
  | 'no_link'
  | 'no_account'
  | 'unknown_account'
  | 'account_tenant_mismatch'
  | 'account_link_mismatch'

export type LinkEventDecision =
  | { ok: true }
  | { ok: false; reason: LinkEventRefusal }

export function authorizeLinkEvent(args: {
  /** Our stripe_payment_links row for the session / payment intent. */
  link: { tenant_id: string; stripe_account_id: string | null } | null
  /** `event.account` — the connected account the event was emitted on. */
  eventAccount: string | null | undefined
  /** tenant_billing_settings.tenant_id for `eventAccount`, or null. */
  accountTenantId: string | null
}): LinkEventDecision {
  if (!args.link) return { ok: false, reason: 'no_link' }
  if (!args.eventAccount) return { ok: false, reason: 'no_account' }
  if (!args.accountTenantId) return { ok: false, reason: 'unknown_account' }
  if (args.accountTenantId !== args.link.tenant_id) {
    return { ok: false, reason: 'account_tenant_mismatch' }
  }
  if (
    args.link.stripe_account_id &&
    args.link.stripe_account_id !== args.eventAccount
  ) {
    return { ok: false, reason: 'account_link_mismatch' }
  }
  return { ok: true }
}

/**
 * Whether the webhook may process requests at all. There is no unsigned
 * mode: with no signing secret configured the endpoint refuses everything,
 * in every environment. (For local testing set STRIPE_WEBHOOK_SECRET and
 * sign the payload — `stripe listen` does this for you.)
 */
export function webhookSecretOrNull(
  env: Record<string, string | undefined>,
): string | null {
  const s = (env.STRIPE_WEBHOOK_SECRET ?? '').trim()
  return s.length > 0 ? s : null
}
