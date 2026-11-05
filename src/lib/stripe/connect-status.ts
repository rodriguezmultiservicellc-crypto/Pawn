/**
 * Stripe Connect — pure helpers (no I/O). Status derivation, redirect /
 * return-URL building, and the row patch we write after re-reading a
 * connected account from Stripe.
 *
 * Kept free of `server-only` so the client-side integrations card and the
 * unit tests can import it. Everything that talks to Stripe or the DB
 * lives in ./connect.ts.
 */

export type ConnectStatus =
  | 'not_connected'
  | 'onboarding_incomplete'
  | 'connected'

/** The subset of a Stripe Account object we care about. */
export type StripeAccountFlags = {
  id: string
  charges_enabled?: boolean | null
  payouts_enabled?: boolean | null
  details_submitted?: boolean | null
}

/** The subset of tenant_billing_settings that drives the status. */
export type ConnectStatusInput = {
  stripeAccountId: string | null | undefined
  chargesEnabled?: boolean | null
  payoutsEnabled?: boolean | null
  detailsSubmitted?: boolean | null
}

/**
 * not_connected        — no account has been created for the tenant yet.
 * onboarding_incomplete — an Express account exists but Stripe has not
 *                         enabled charges yet (details missing, pending
 *                         verification, or the owner abandoned the flow).
 * connected            — details submitted AND charges enabled. Payouts
 *                         may still be pending (bank account under review);
 *                         that is surfaced separately, it does not block
 *                         taking payments.
 */
export function deriveConnectStatus(input: ConnectStatusInput): ConnectStatus {
  if (!input.stripeAccountId) return 'not_connected'
  if (input.detailsSubmitted && input.chargesEnabled) return 'connected'
  return 'onboarding_incomplete'
}

/** "acct_1Nv…8Q2k" → "8Q2k". Never shows the whole id in the UI. */
export function accountIdSuffix(
  id: string | null | undefined,
  length = 4,
): string | null {
  if (!id) return null
  return id.slice(-length)
}

/** Strip a trailing slash so paths concatenate predictably. */
export function normalizeAppUrl(appUrl: string | undefined | null): string {
  if (!appUrl || !appUrl.trim()) {
    throw new Error('next_public_app_url_missing')
  }
  return appUrl.trim().replace(/\/+$/, '')
}

export const CONNECT_PATHS = {
  start: '/api/stripe/connect/start',
  callback: '/api/stripe/connect/callback',
  dashboard: '/api/stripe/connect/dashboard',
  settings: '/settings/integrations',
} as const

/**
 * URLs handed to Stripe when creating an Account Link.
 *   return_url  — where Stripe sends the owner after they finish (or leave)
 *                 the hosted onboarding. We re-read the account there.
 *   refresh_url — where Stripe sends them when the link expired or was
 *                 already used. /start reuses the account and mints a
 *                 fresh link, so pointing refresh straight at it is correct.
 */
export function buildAccountLinkUrls(appUrl: string | undefined | null): {
  returnUrl: string
  refreshUrl: string
} {
  const base = normalizeAppUrl(appUrl)
  return {
    returnUrl: `${base}${CONNECT_PATHS.callback}`,
    refreshUrl: `${base}${CONNECT_PATHS.start}`,
  }
}

/** The `?stripe=` values the integrations page knows how to render. */
export type ConnectRedirectFlag =
  | 'connected'
  | 'incomplete'
  | 'not_connected'
  | 'forbidden'
  | 'misconfigured'
  | 'stripe_error'
  | 'save_failed'

/** Absolute URL back to Settings → Integrations with a status flag. */
export function buildSettingsRedirect(
  appUrl: string | undefined | null,
  flag: ConnectRedirectFlag,
): string {
  const base = normalizeAppUrl(appUrl)
  const u = new URL(`${base}${CONNECT_PATHS.settings}`)
  u.searchParams.set('stripe', flag)
  return u.toString()
}

export function flagForStatus(status: ConnectStatus): ConnectRedirectFlag {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'onboarding_incomplete':
      return 'incomplete'
    default:
      return 'not_connected'
  }
}

/** Columns we write on tenant_billing_settings after a status sync. */
export type BillingStatusPatch = {
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  stripe_details_submitted: boolean
  stripe_status_synced_at: string
  billing_enabled: boolean
  stripe_connected_at?: string
}

/**
 * Build the row patch from a freshly-read Stripe account.
 *
 *   billing_enabled      mirrors charges_enabled — payment-link.ts and the
 *                        POS gate on it, so a tenant whose charges get
 *                        disabled by Stripe stops taking cards immediately.
 *   stripe_connected_at  is set ONCE, the first time the account reaches
 *                        'connected'. Never cleared, never moved — it is
 *                        the "went live" timestamp, not a status flag.
 */
export function billingPatchFromAccount(
  account: StripeAccountFlags,
  opts: { now: Date; existingConnectedAt: string | null | undefined },
): BillingStatusPatch {
  const charges = account.charges_enabled === true
  const payouts = account.payouts_enabled === true
  const details = account.details_submitted === true
  const patch: BillingStatusPatch = {
    stripe_charges_enabled: charges,
    stripe_payouts_enabled: payouts,
    stripe_details_submitted: details,
    stripe_status_synced_at: opts.now.toISOString(),
    billing_enabled: charges,
  }
  const status = deriveConnectStatus({
    stripeAccountId: account.id,
    chargesEnabled: charges,
    payoutsEnabled: payouts,
    detailsSubmitted: details,
  })
  if (status === 'connected' && !opts.existingConnectedAt) {
    patch.stripe_connected_at = opts.now.toISOString()
  }
  return patch
}
