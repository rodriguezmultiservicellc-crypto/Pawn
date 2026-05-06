/**
 * eBay OAuth helpers — per-tenant token lifecycle.
 *
 * STUB STAGE — every function here that would normally make a network call
 * to eBay's `/identity/v1/oauth2/token` endpoint instead synthesises plausible
 * tokens and persists them. The control flow + persistence shape match what
 * the real implementation will look like; only the network round-trip is
 * faked. Each STUB function is marked with a comment.
 *
 * REAL WIRE-UP (follow-up after credentials):
 *   - finishOAuth POSTs `grant_type=authorization_code&code=...` to
 *     https://api.ebay.com/identity/v1/oauth2/token (or sandbox host) with
 *     a Basic auth header `Base64(EBAY_CLIENT_ID:EBAY_CLIENT_SECRET)`.
 *   - refreshAccessToken POSTs `grant_type=refresh_token&refresh_token=...`
 *     to the same endpoint. eBay refresh tokens are valid for 18 months;
 *     access tokens for 2 hours.
 *   - resolveCredentials transparently refreshes if access_token has
 *     expired or is within 60s of expiring.
 *
 * Server-only — never import from a client component.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSecret, setTenantSecret } from '@/lib/secrets/vault'
import type {
  EbayEnvironment,
  TenantEbayCredentialsRow,
  TenantEbayCredentialsUpdate,
} from '@/types/database-aliases'
import type {
  EbayTokenBundle,
  ResolvedEbayCredentials,
} from './types'

const SANDBOX_API_BASE = 'https://api.sandbox.ebay.com'
const PRODUCTION_API_BASE = 'https://api.ebay.com'

const SANDBOX_AUTH_BASE = 'https://auth.sandbox.ebay.com'
const PRODUCTION_AUTH_BASE = 'https://auth.ebay.com'

/**
 * Default OAuth scopes — Sell Inventory + Sell Account + Sell Marketing +
 * commerce identity (so we can resolve ebay_user_id at callback time).
 *
 * Configure via env so the operator can narrow if eBay declines an app for
 * over-broad scopes.
 */
const DEFAULT_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
].join(' ')

export function ebayApiBase(env: EbayEnvironment): string {
  return env === 'production' ? PRODUCTION_API_BASE : SANDBOX_API_BASE
}

function ebayAuthBase(env: EbayEnvironment): string {
  return env === 'production' ? PRODUCTION_AUTH_BASE : SANDBOX_AUTH_BASE
}

function ebayClientId(env: EbayEnvironment): string {
  // STUB tolerance — when EBAY_CLIENT_ID is missing we still produce a
  // workable consent URL for UI demos; the consent screen will reject it
  // until a real app key is configured.
  return (
    process.env[
      env === 'production' ? 'EBAY_CLIENT_ID' : 'EBAY_SANDBOX_CLIENT_ID'
    ] ??
    process.env.EBAY_CLIENT_ID ??
    'PAWN-STUB-CLIENT-ID'
  )
}

function ebayRedirectUri(env: EbayEnvironment): string {
  // eBay calls this the "RuName" — the operator will set it after applying
  // for the developer account. For UI demos we fall back to our local URL.
  return (
    process.env[
      env === 'production' ? 'EBAY_REDIRECT_URI' : 'EBAY_SANDBOX_REDIRECT_URI'
    ] ??
    process.env.EBAY_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3060'}/api/ebay/oauth/callback`
  )
}

/**
 * Build the eBay OAuth consent URL. The state cookie is the only thing
 * binding the round-trip to the originating user — we set it as an
 * HttpOnly cookie at the start route.
 */
export function startOAuth(args: {
  tenantId: string
  state: string
  environment?: EbayEnvironment
  scopes?: string
}): { url: string; environment: EbayEnvironment } {
  const env: EbayEnvironment = args.environment ?? 'sandbox'
  const params = new URLSearchParams({
    client_id: ebayClientId(env),
    redirect_uri: ebayRedirectUri(env),
    response_type: 'code',
    scope: args.scopes ?? DEFAULT_SCOPES,
    state: args.state,
  })
  const base = ebayAuthBase(env)
  // eBay OAuth consent flow lives at /oauth2/authorize on the auth host.
  return { url: `${base}/oauth2/authorize?${params.toString()}`, environment: env }
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: POST to `${ebayApiBase(env)}/identity/v1/oauth2/token` with
 *   Authorization: Basic Base64(client_id:client_secret)
 *   Content-Type: application/x-www-form-urlencoded
 *   body: grant_type=authorization_code&code=<code>&redirect_uri=<RuName>
 * Response (real): { access_token, expires_in, refresh_token,
 *   refresh_token_expires_in, token_type }.
 *
 * Stub returns synthetic tokens with realistic expirations.
 */
export async function finishOAuth(args: {
  tenantId: string
  code: string
  environment?: EbayEnvironment
}): Promise<EbayTokenBundle> {
  const env: EbayEnvironment = args.environment ?? 'sandbox'
  const now = Date.now()
  // eBay token TTLs: access 2h (7200s), refresh 18 months (~47304000s).
  const access = `STUB-ACCESS-${args.tenantId}-${now}`
  const refresh = `STUB-REFRESH-${args.tenantId}-${now}`
  const ebayUserId = `stub_user_${args.tenantId.slice(0, 8)}`

  const bundle: EbayTokenBundle = {
    ebay_user_id: ebayUserId,
    access_token: access,
    access_token_expires_at: new Date(now + 7200 * 1000).toISOString(),
    refresh_token: refresh,
    refresh_token_expires_at: new Date(
      now + 47_304_000 * 1000,
    ).toISOString(),
    environment: env,
  }
  return bundle
}

/**
 * STUB — replace with real eBay Sell API call when credentials wired.
 *
 * Real impl: POST to `${ebayApiBase(env)}/identity/v1/oauth2/token` with
 *   grant_type=refresh_token&refresh_token=<refresh>&scope=<scopes>
 * Response: { access_token, expires_in, token_type }.
 *
 * Stub mints a fresh access token and re-uses the existing refresh token.
 */
export async function refreshAccessToken(args: {
  tenantId: string
  currentRefreshToken: string
  environment: EbayEnvironment
}): Promise<{ access_token: string; access_token_expires_at: string }> {
  const now = Date.now()
  return {
    access_token: `STUB-ACCESS-REFRESHED-${args.tenantId}-${now}`,
    access_token_expires_at: new Date(now + 7200 * 1000).toISOString(),
  }
}

/**
 * Persist a token bundle on tenant_ebay_credentials. Used by the OAuth
 * callback (insert-or-update) and by refreshAccessToken (update).
 *
 * Caller must already have guarded the tenant — service-role used here.
 */
export async function persistTokens(args: {
  tenantId: string
  bundle: Partial<EbayTokenBundle> & {
    environment?: EbayEnvironment
  }
  siteId?: string
  connectedAt?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const update: TenantEbayCredentialsUpdate = {
    ebay_user_id: args.bundle.ebay_user_id ?? null,
    access_token: args.bundle.access_token ?? null,
    access_token_expires_at: args.bundle.access_token_expires_at ?? null,
    refresh_token: args.bundle.refresh_token ?? null,
    refresh_token_expires_at: args.bundle.refresh_token_expires_at ?? null,
    environment: args.bundle.environment ?? 'sandbox',
    site_id: args.siteId ?? 'EBAY_US',
    connected_at: args.connectedAt ?? now,
    disconnected_at: null,
  }

  const supa = admin
  const existing = await supa
    .from('tenant_ebay_credentials')
    .select('tenant_id')
    .eq('tenant_id', args.tenantId)
    .maybeSingle()

  if (existing.data) {
    await supa
      .from('tenant_ebay_credentials')
      .update(update)
      .eq('tenant_id', args.tenantId)
  } else {
    await supa
      .from('tenant_ebay_credentials')
      .insert({ tenant_id: args.tenantId, ...update })
  }

  // Dual-write tokens to vault. Plaintext column update above keeps
  // pre-migration read paths working; vault is the source of truth for
  // read sites that have cut over (resolveCredentials below).
  await setTenantSecret(
    args.tenantId,
    'ebay_access_token',
    args.bundle.access_token ?? null,
  )
  await setTenantSecret(
    args.tenantId,
    'ebay_refresh_token',
    args.bundle.refresh_token ?? null,
  )
}

/**
 * Mark a tenant disconnected — wipe tokens but keep the row for audit
 * trail ("was connected from X to Y").
 */
export async function markDisconnected(tenantId: string): Promise<void> {
  const admin = createAdminClient()
  const supa = admin
  await supa
    .from('tenant_ebay_credentials')
    .update({
      access_token: null,
      access_token_expires_at: null,
      refresh_token: null,
      refresh_token_expires_at: null,
      disconnected_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
  // Clear vault entries too — disconnect should leave no trace of the
  // tokens anywhere. setTenantSecret with null deletes the registry row
  // and the underlying vault.secrets row.
  await setTenantSecret(tenantId, 'ebay_access_token', null)
  await setTenantSecret(tenantId, 'ebay_refresh_token', null)
}

/**
 * Load tenant credentials, refreshing the access token if expired.
 * Throws 'tenant_ebay_not_connected' when there's no usable refresh token.
 */
export async function resolveCredentials(
  tenantId: string,
): Promise<ResolvedEbayCredentials> {
  const admin = createAdminClient()
  const supa = admin
  const { data: row } = (await supa
    .from('tenant_ebay_credentials')
    .select(
      'tenant_id, ebay_user_id, refresh_token, refresh_token_expires_at, access_token, access_token_expires_at, environment, site_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, connected_at, disconnected_at',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: TenantEbayCredentialsRow | null }

  // Vault-first read for both tokens. Plaintext columns are the
  // fallback during the dual-state window; once 0034 drops them this
  // collapses to direct getTenantSecret() calls.
  const refreshToken = await resolveSecret(
    tenantId,
    'ebay_refresh_token',
    row?.refresh_token ?? null,
  )
  if (!row || !refreshToken) {
    throw new Error('tenant_ebay_not_connected')
  }

  const now = Date.now()
  const accessExp = row.access_token_expires_at
    ? Date.parse(row.access_token_expires_at)
    : 0
  const accessFromVault = await resolveSecret(
    tenantId,
    'ebay_access_token',
    row.access_token ?? null,
  )
  let accessToken = accessFromVault ?? ''
  if (!accessToken || accessExp - now < 60 * 1000) {
    // Refresh — STUB returns fresh stub token.
    const refreshed = await refreshAccessToken({
      tenantId,
      currentRefreshToken: refreshToken,
      environment: row.environment,
    })
    accessToken = refreshed.access_token
    await persistTokens({
      tenantId,
      bundle: {
        ebay_user_id: row.ebay_user_id ?? undefined,
        refresh_token: refreshToken,
        refresh_token_expires_at: row.refresh_token_expires_at ?? undefined,
        access_token: refreshed.access_token,
        access_token_expires_at: refreshed.access_token_expires_at,
        environment: row.environment,
      },
      siteId: row.site_id,
      connectedAt: row.connected_at,
    })
  }

  return {
    tenantId,
    ebayUserId: row.ebay_user_id,
    accessToken,
    environment: row.environment,
    siteId: row.site_id,
    apiBase: ebayApiBase(row.environment),
    merchantLocationKey: row.merchant_location_key,
    fulfillmentPolicyId: row.fulfillment_policy_id,
    paymentPolicyId: row.payment_policy_id,
    returnPolicyId: row.return_policy_id,
  }
}

/** Read raw credentials row (no refresh). For the settings UI. */
export async function loadCredentialsRow(
  tenantId: string,
): Promise<TenantEbayCredentialsRow | null> {
  const admin = createAdminClient()
  const supa = admin
  const { data } = (await supa
    .from('tenant_ebay_credentials')
    .select(
      'tenant_id, ebay_user_id, refresh_token, refresh_token_expires_at, access_token, access_token_expires_at, environment, site_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, connected_at, disconnected_at, created_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: TenantEbayCredentialsRow | null }
  return data ?? null
}
