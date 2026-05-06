-- ───────────────────────────────────────────────────────────────────────────
-- 0033 — tenant secrets vault (encryption-at-rest backbone)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0032 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Encrypts per-tenant credentials at rest using Supabase Vault
--   (libsodium-backed). Closes the architectural recommendation from
--   the external review (0019 closed the disclosure path; this closes
--   the at-rest exposure).
--
--   Architecture (separate table, NOT inline secret_id columns):
--
--     tenant_secrets         registry: (tenant_id, kind) UNIQUE → vault id
--     vault.secrets          managed by Supabase; libsodium ciphertext
--     vault.decrypted_secrets view used inside SECURITY DEFINER RPC only
--
--     RPCs (service_role only):
--       set_tenant_secret(tenant_id, kind, value)  → vault id (stable)
--       get_tenant_secret(tenant_id, kind)         → plaintext or NULL
--
--     Plaintext columns on settings / tenant_billing_settings /
--     tenant_ebay_credentials remain in place during the dual-state
--     transition. Read paths switch one at a time using the TS helper
--     at src/lib/secrets/vault.ts (vault-first, plaintext-fallback).
--     Migration 0034 (separate, future) will drop plaintext columns
--     once all read + write paths cut over.
--
--   Backfill: every existing non-empty plaintext secret is copied into
--   vault during this migration. Idempotent — re-running only acts on
--   secrets not yet registered.
--
-- Why a separate `tenant_secrets` registry (not per-table secret_id columns)
--
--   Single audit surface for every secret read. One RLS policy. The
--   business-data tables (settings, tenant_billing_settings,
--   tenant_ebay_credentials) stay focused on operational state; secret
--   storage is decoupled. Drops the eventual plaintext-column removal
--   to a one-line ALTER per column instead of a coordinated rename.
--
-- Why `kind` is TEXT (not an enum)
--
--   Adding a new secret kind shouldn't require an ALTER TYPE ADD VALUE
--   migration. Validation lives in the RPC + the TS helper's typed
--   union. The DB stores arbitrary kind strings to keep the registry
--   forward-compatible.
--
-- Vault availability
--
--   `vault` schema is auto-provisioned on every Supabase project. If
--   you're applying this against a self-hosted PG without vault, this
--   migration will fail at the `vault.create_secret` call inside the
--   backfill DO block — fine, since the dual-state design means the
--   plaintext columns continue working until cutover.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── tenant_secrets registry ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_secrets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  vault_secret_id UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_tenant_secrets_tenant
  ON public.tenant_secrets(tenant_id);

DROP TRIGGER IF EXISTS trg_tenant_secrets_updated_at ON public.tenant_secrets;
CREATE TRIGGER trg_tenant_secrets_updated_at
  BEFORE UPDATE ON public.tenant_secrets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS — service-role-only registry ─────────────────────────────────────
--
-- No policies. Without any policy granting SELECT/INSERT/UPDATE/DELETE,
-- only service_role (which bypasses RLS) can touch this table. Authed
-- users — including owners — must go through the RPCs below, which gate
-- on SECURITY DEFINER + EXECUTE grants. Belt + suspenders: the registry
-- never leaks via a buggy join, and the vault.decrypted_secrets view is
-- only ever queried inside `get_tenant_secret`.

ALTER TABLE public.tenant_secrets ENABLE ROW LEVEL SECURITY;

-- ── set_tenant_secret ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_tenant_secret(
  p_tenant_id UUID,
  p_kind      TEXT,
  p_value     TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id UUID;
  v_vault_id    UUID;
  v_name        TEXT;
BEGIN
  -- Empty value = clear: drop both vault row and registry entry.
  -- Operators clearing a credential expect "no leftover stored anywhere".
  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    SELECT vault_secret_id INTO v_existing_id
      FROM public.tenant_secrets
      WHERE tenant_id = p_tenant_id AND kind = p_kind;
    IF v_existing_id IS NOT NULL THEN
      -- DELETE from vault.secrets cascades the encryption key handle.
      DELETE FROM vault.secrets WHERE id = v_existing_id;
    END IF;
    DELETE FROM public.tenant_secrets
      WHERE tenant_id = p_tenant_id AND kind = p_kind;
    RETURN NULL;
  END IF;

  v_name := 'tenant:' || p_tenant_id::text || ':' || p_kind;

  SELECT vault_secret_id INTO v_existing_id
    FROM public.tenant_secrets
    WHERE tenant_id = p_tenant_id AND kind = p_kind;

  IF v_existing_id IS NOT NULL THEN
    -- Rotate in place. Stable vault_secret_id keeps audit trails clean.
    PERFORM vault.update_secret(v_existing_id, p_value, v_name, NULL);
    UPDATE public.tenant_secrets
      SET updated_at = NOW()
      WHERE tenant_id = p_tenant_id AND kind = p_kind;
    RETURN v_existing_id;
  ELSE
    -- New secret. vault.create_secret encrypts + stores; we register
    -- the link.
    v_vault_id := vault.create_secret(
      p_value,
      v_name,
      'Tenant credential managed via public.tenant_secrets'
    );
    INSERT INTO public.tenant_secrets (tenant_id, kind, vault_secret_id)
      VALUES (p_tenant_id, p_kind, v_vault_id);
    RETURN v_vault_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_secret(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_secret(UUID, TEXT, TEXT) TO service_role;

-- ── get_tenant_secret ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_tenant_secret(
  p_tenant_id UUID,
  p_kind      TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret_id UUID;
  v_decrypted TEXT;
BEGIN
  SELECT vault_secret_id INTO v_secret_id
    FROM public.tenant_secrets
    WHERE tenant_id = p_tenant_id AND kind = p_kind;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_decrypted
    FROM vault.decrypted_secrets
    WHERE id = v_secret_id;
  RETURN v_decrypted;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_secret(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_secret(UUID, TEXT) TO service_role;

-- ── Backfill: copy existing plaintext into vault ─────────────────────────
--
-- Idempotent — `set_tenant_secret` rotates an existing secret in place
-- if a row already exists for (tenant_id, kind), so re-running is a
-- no-op aside from updated_at bumps.
--
-- Plaintext columns are NOT cleared. Read paths cut over one at a time
-- using vault-first / plaintext-fallback (see src/lib/secrets/vault.ts).
-- A future migration (0034) drops plaintext columns once all paths are
-- on vault.

DO $backfill$
DECLARE
  r RECORD;
  v_kinds_settings TEXT[] := ARRAY[
    'twilio_auth_token',
    'resend_api_key',
    'google_places_api_key'
  ];
  v_kinds_billing TEXT[] := ARRAY[
    'stripe_access_token',
    'stripe_refresh_token',
    'stripe_webhook_secret'
  ];
  v_kinds_ebay TEXT[] := ARRAY[
    'ebay_access_token',
    'ebay_refresh_token'
  ];
  v_kind TEXT;
  v_query TEXT;
BEGIN
  -- settings
  FOREACH v_kind IN ARRAY v_kinds_settings LOOP
    v_query := format(
      'SELECT tenant_id, %I AS v FROM public.settings
        WHERE %I IS NOT NULL AND length(trim(%I)) > 0',
      v_kind, v_kind, v_kind
    );
    FOR r IN EXECUTE v_query LOOP
      PERFORM public.set_tenant_secret(r.tenant_id, v_kind, r.v);
    END LOOP;
  END LOOP;

  -- tenant_billing_settings — column names match kind names except where noted.
  -- (All three columns happen to share their kind names; no remap needed.)
  FOREACH v_kind IN ARRAY v_kinds_billing LOOP
    v_query := format(
      'SELECT tenant_id, %I AS v FROM public.tenant_billing_settings
        WHERE %I IS NOT NULL AND length(trim(%I)) > 0',
      v_kind, v_kind, v_kind
    );
    FOR r IN EXECUTE v_query LOOP
      PERFORM public.set_tenant_secret(r.tenant_id, v_kind, r.v);
    END LOOP;
  END LOOP;

  -- tenant_ebay_credentials uses unprefixed `access_token` / `refresh_token`
  -- columns. Map to prefixed kinds so the registry namespace doesn't
  -- collide with stripe_*.
  FOR r IN
    SELECT tenant_id, access_token AS v FROM public.tenant_ebay_credentials
      WHERE access_token IS NOT NULL AND length(trim(access_token)) > 0
  LOOP
    PERFORM public.set_tenant_secret(r.tenant_id, 'ebay_access_token', r.v);
  END LOOP;
  FOR r IN
    SELECT tenant_id, refresh_token AS v FROM public.tenant_ebay_credentials
      WHERE refresh_token IS NOT NULL AND length(trim(refresh_token)) > 0
  LOOP
    PERFORM public.set_tenant_secret(r.tenant_id, 'ebay_refresh_token', r.v);
  END LOOP;

  -- Suppress unused-variable warning for the array vars used only via FOREACH.
  PERFORM v_kinds_settings, v_kinds_billing, v_kinds_ebay;
END
$backfill$;

COMMIT;

-- Tell PostgREST to pick up the new table + RPCs.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual; safe before any read paths flip to vault-first)
-- ───────────────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.get_tenant_secret(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.set_tenant_secret(UUID, TEXT, TEXT);
--   -- Vault rows orphan but are otherwise harmless. Optional cleanup:
--   --   DELETE FROM vault.secrets
--   --     WHERE name LIKE 'tenant:%';
--   DROP TABLE IF EXISTS public.tenant_secrets;
-- COMMIT;

-- ============================================================================
-- END 0033-tenant-secrets-vault.sql
-- ============================================================================
