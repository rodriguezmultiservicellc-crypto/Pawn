/**
 * Tenant secrets — Supabase-Vault-backed encryption-at-rest helpers.
 *
 * Wraps the `set_tenant_secret` / `get_tenant_secret` RPCs (introduced in
 * patches/0033 and reaffirmed by patches/0034) with a typed kind union, so
 * read sites get autocomplete + the misspelled-kind class of bugs is
 * caught at compile time instead of leaving secrets unreadable in prod.
 *
 * Vault is the SOLE storage for these credentials. The original plaintext
 * columns on `settings` / `tenant_billing_settings` / `tenant_ebay_credentials`
 * were dropped during the Session 25/26 cutover — there is no fallback.
 *
 * This file is server-only — the RPCs are SECURITY DEFINER and granted
 * to service_role only, so there's no client-bundle path that could
 * accidentally fan out to a browser.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type SecretKind =
  // settings
  | 'twilio_auth_token'
  | 'resend_api_key'
  | 'google_places_api_key'
  // tenant_billing_settings
  | 'stripe_access_token'
  | 'stripe_refresh_token'
  | 'stripe_webhook_secret'
  // tenant_ebay_credentials
  | 'ebay_access_token'
  | 'ebay_refresh_token'

/**
 * Fetch a secret from vault. Returns null on missing row, empty value,
 * or RPC error — secrets never throw to user-facing surfaces.
 */
export async function getTenantSecret(
  tenantId: string,
  kind: SecretKind,
): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_tenant_secret', {
    p_tenant_id: tenantId,
    p_kind: kind,
  })
  if (error) {
    console.error('[vault] get_tenant_secret failed', kind, error.message)
    return null
  }
  if (typeof data !== 'string' || data.length === 0) return null
  return data
}

/**
 * Upsert a secret into vault. Empty / null value clears both vault row
 * and registry entry — operators clearing a credential expect "no
 * leftover". Returns the stable vault id (or null if cleared).
 */
export async function setTenantSecret(
  tenantId: string,
  kind: SecretKind,
  value: string | null,
): Promise<{ ok: true; vaultId: string | null } | { ok: false; error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('set_tenant_secret', {
    p_tenant_id: tenantId,
    p_kind: kind,
    p_value: value ?? '',
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, vaultId: typeof data === 'string' ? data : null }
}

/**
 * Cheap "is this kind configured?" check that avoids decrypting the
 * secret. Reads the registry directly (no vault round-trip). Useful for
 * "(connected)" / "(not configured)" badges in the settings UI.
 */
export async function isSecretConfigured(
  tenantId: string,
  kind: SecretKind,
): Promise<boolean> {
  const admin = createAdminClient()
  const { count, error } = await admin
    .from('tenant_secrets')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('kind', kind)
  if (error) {
    console.error('[vault] isSecretConfigured failed', kind, error.message)
    return false
  }
  return (count ?? 0) > 0
}

/**
 * Bulk variant of `isSecretConfigured`. Returns the set of kinds that
 * have a row for this tenant. One query → many flags. Use this when
 * a page renders multiple "configured" badges (e.g. settings index).
 */
export async function loadConfiguredSecretKinds(
  tenantId: string,
): Promise<Set<SecretKind>> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tenant_secrets')
    .select('kind')
    .eq('tenant_id', tenantId)
  if (error) {
    console.error('[vault] loadConfiguredSecretKinds failed', error.message)
    return new Set()
  }
  const out = new Set<SecretKind>()
  for (const row of data ?? []) {
    if (typeof row.kind === 'string') {
      out.add(row.kind as SecretKind)
    }
  }
  return out
}
