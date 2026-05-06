/**
 * Tenant secrets — Supabase-Vault-backed encryption-at-rest helpers.
 *
 * Wraps the `set_tenant_secret` / `get_tenant_secret` RPCs from
 * patches/0033-tenant-secrets-vault.sql with a typed kind union, so
 * read sites get autocomplete + the misspelled-kind class of bugs is
 * caught at compile time instead of leaving secrets unreadable in prod.
 *
 * Migration plan (2026-05-05):
 *   1. ✅ migration 0033 — vault registry + RPCs + backfill
 *   2. Read paths cut over to `getTenantSecret(...)` with plaintext
 *      fallback during the dual-state window. ONE path proven this
 *      session (resend_api_key in lib/email/send.ts); remainder
 *      follow the same template.
 *   3. Write paths cut over to `setTenantSecret(...)` PLUS keep the
 *      plaintext column write so old read paths don't break.
 *   4. After all read + write paths are on vault: migration 0034
 *      drops the plaintext columns.
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
 * Fetch a secret from vault. Returns null if no row in tenant_secrets
 * (caller should fall back to the plaintext column during the dual-
 * state migration window). Returns null on RPC error too — secrets
 * never throw to user-facing surfaces.
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
 *
 * Callers should ALSO write the plaintext column during the dual-state
 * window so read paths that haven't cut over yet still work.
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
 * Read a secret with vault-first / plaintext-fallback semantics. Use
 * this from read sites during the dual-state migration window.
 *
 * If vault returns a value, use it.
 * If vault is empty (no migrated row yet, or a write happened that
 * didn't dual-write), fall back to the supplied plaintext.
 *
 * Once all write paths dual-write reliably, this fallback can be
 * removed and read sites can call getTenantSecret() directly.
 */
export async function resolveSecret(
  tenantId: string,
  kind: SecretKind,
  plaintextFallback: string | null,
): Promise<string | null> {
  const vaultValue = await getTenantSecret(tenantId, kind)
  if (vaultValue !== null) return vaultValue
  if (plaintextFallback && plaintextFallback.length > 0) return plaintextFallback
  return null
}
