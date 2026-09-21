-- ===========================================================================
-- 0056 — CLOSE THE profiles PRIVILEGE-ESCALATION HOLE
-- ===========================================================================
-- Inherited from the saas-builder scaffold (flagged 2026-07-03, confirmed
-- live-vulnerable on this project 2026-09-21 by a read-only audit).
--
-- THE HOLE
--   Policy profiles_update_own is  FOR UPDATE USING (id = auth.uid())  with no
--   WITH CHECK, so Postgres reuses USING for the check — it pins ROW OWNERSHIP
--   and nothing else. Separately, Supabase's default grants gave `anon` and
--   `authenticated` table-level UPDATE on profiles, INCLUDING the columns
--   `role` and `tenant_id`.
--
--   Net effect: any logged-in user could
--       PATCH /rest/v1/profiles?id=eq.<self>   {"role":"superadmin"}
--   and become a platform superadmin. my_is_superadmin() short-circuits tenant
--   policies, and billing_invoices / tenant_subscriptions gate directly on
--   profiles.role = 'superadmin' — so the payoff is full cross-tenant read+write
--   plus the billing surface. The audit trigger only LOGS the change.
--
--   RLS is not a column-authorization control. The GRANT layer is. Fixed here.
--
-- WHAT THIS PATCH DOES
--   1. Revokes the write grants Supabase handed out by default.
--   2. Re-grants UPDATE on ONLY the three columns a user genuinely owns about
--      themselves. Deliberately excluded:
--        role, tenant_id  — privilege columns, the whole point of this patch
--        id               — identity, FK to auth.users
--        created_at/updated_at — updated_at is set by trg_profiles_updated_at;
--                           a trigger writing a column does not require the
--                           CALLER to hold UPDATE on it, so excluding it is safe
--        email            — mirrors auth.users.email and is rendered as identity
--                           in /audit and /team. Self-editable = a staffer can
--                           impersonate another staffer in the audit trail.
--   3. Adds a guard trigger so the invariant survives a future re-GRANT. The
--      scaffold that opened this hole can be re-run, and Supabase's default
--      privileges are broad; a lone REVOKE is one careless `GRANT ALL` away
--      from being undone. The trigger is the durable statement of intent.
--
-- NOT CHANGED: no RLS policy is touched by this patch (CLAUDE.md rule 1).
-- SELECT grants are left alone — reads are correctly gated by
-- profiles_self_read.
--
-- INSERT/DELETE are revoked as well. This is a no-op in practice: profiles has
-- no INSERT and no DELETE policy, so RLS already blocked both for any end-user
-- JWT. Revoking makes the grant layer agree with the policy layer.
--
-- AUDIT NOTE (2026-09-21): the companion scaffold hole — schema_migrations with
-- RLS off — does NOT exist here. This project has no schema_migrations table,
-- and every table in `public` already has RLS enabled. Nothing to do.
-- ===========================================================================

-- ── 1. Take back the default write grants ─────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.profiles FROM anon, authenticated;

-- ── 2. Hand back only the self-owned presentation columns ─────────────────
-- Today only /api/profile/language writes as the user. full_name and
-- avatar_url are the user's own display data and carry no authorization
-- meaning, so a profile page can use them without another migration.
GRANT UPDATE (full_name, avatar_url, language)
  ON public.profiles TO authenticated;

-- ── 3. Durable guard: privilege columns are never writable under a user JWT ─
CREATE OR REPLACE FUNCTION public.profiles_guard_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim_role TEXT;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  -- Escape hatch for the one sanctioned server-side writer. Set as a LOCAL
  -- GUC, so it dies with the transaction and cannot be left switched on.
  IF COALESCE(current_setting('app.profile_privilege_write', TRUE), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- service_role (the admin client, crons) and direct SQL carry no end-user
  -- JWT. Those paths are already gated by requireSuperAdmin() in app code.
  v_claim_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::jsonb ->> 'role',
    ''
  );
  IF v_claim_role IN ('service_role', '') AND auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'profiles.role and profiles.tenant_id are not self-editable (user %)',
    COALESCE(auth.uid()::text, 'unknown')
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_privilege_columns ON public.profiles;
CREATE TRIGGER trg_profiles_guard_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_privilege_columns();

-- ── 4. Teach the one legitimate writer to announce itself ─────────────────
-- claim_tenant_with_license_key is SECURITY DEFINER (so the column grants do
-- not apply to it) but it is CALLED by a freshly-onboarded user, whose JWT is
-- still on the connection — the guard above would otherwise reject it. Body is
-- byte-for-byte 0001's apart from the set_config line.
CREATE OR REPLACE FUNCTION claim_tenant_with_license_key(
  p_user_id      UUID,
  p_license_key  TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants
  WHERE license_key = p_license_key AND is_active = TRUE;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or already-used license key.';
  END IF;

  INSERT INTO user_tenants (user_id, tenant_id, role)
  VALUES (p_user_id, v_tenant_id, 'owner')
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner', is_active = TRUE;

  -- Sanctioned privilege-column write; TRUE = transaction-local.
  PERFORM set_config('app.profile_privilege_write', 'on', TRUE);
  UPDATE profiles SET tenant_id = v_tenant_id WHERE id = p_user_id;
  PERFORM set_config('app.profile_privilege_write', 'off', TRUE);

  -- Consume the key.
  UPDATE tenants SET license_key = NULL WHERE id = v_tenant_id;

  RETURN v_tenant_id;
END;
$$;
