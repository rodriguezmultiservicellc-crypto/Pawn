-- ============================================================================
-- 0002 — fix: create_tenant_with_owner column-reference ambiguity
-- File:    patches/0002-fix-create-tenant-ambiguous-column.sql
-- Date:    2026-04-26
--
-- The original function in 0001-foundation.sql declared
--   RETURNS TABLE (tenant_id UUID, license_key TEXT)
-- which makes `tenant_id` and `license_key` OUT parameter names. Inside the
-- function body, the INSERT statements reference columns ALSO named
-- `tenant_id` and `license_key` (settings.tenant_id, tenants.license_key,
-- the ON CONFLICT (user_id, tenant_id) target). Postgres can't decide which
-- referent to use and throws "column reference 'tenant_id' is ambiguous".
--
-- Fix: add `#variable_conflict use_column` at the top of the function body.
-- This tells PL/pgSQL that when a name is ambiguous between a parameter /
-- output name and a column, prefer the column. The local variables
-- (v_tenant_id, v_license_key) are unique-named and unaffected; only the
-- RETURNS TABLE OUT params and column references conflict, and the column
-- is what we mean inside the INSERTs.
--
-- Public API (TS-side rpc('create_tenant_with_owner', { ... }) → SETOF
-- (tenant_id, license_key)) is unchanged.
--
-- Apply: paste into Supabase SQL Editor and run.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_tenant_with_owner(
  p_name                 TEXT,
  p_superadmin_user_id   UUID,
  p_owner_user_id        UUID DEFAULT NULL,
  p_parent_tenant_id     UUID DEFAULT NULL,
  p_tenant_type          tenant_type DEFAULT 'standalone',
  p_dba                  TEXT DEFAULT NULL,
  p_address              TEXT DEFAULT NULL,
  p_city                 TEXT DEFAULT NULL,
  p_state                TEXT DEFAULT 'FL',
  p_zip                  TEXT DEFAULT NULL,
  p_phone                TEXT DEFAULT NULL,
  p_email                TEXT DEFAULT NULL,
  p_has_pawn             BOOLEAN DEFAULT TRUE,
  p_has_repair           BOOLEAN DEFAULT TRUE,
  p_has_retail           BOOLEAN DEFAULT TRUE,
  p_police_report_format police_report_format DEFAULT 'fl_leadsonline'
) RETURNS TABLE (tenant_id UUID, license_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id    UUID;
  v_license_key  TEXT;
BEGIN
  v_license_key := uuid_generate_v4()::TEXT;

  INSERT INTO tenants (
    name, dba, parent_tenant_id, tenant_type,
    has_pawn, has_repair, has_retail, police_report_format,
    address, city, state, zip, phone, email, license_key
  )
  VALUES (
    p_name, p_dba, p_parent_tenant_id, p_tenant_type,
    p_has_pawn, p_has_repair, p_has_retail, p_police_report_format,
    p_address, p_city, p_state, p_zip, p_phone, p_email, v_license_key
  )
  RETURNING tenants.id INTO v_tenant_id;

  INSERT INTO settings (tenant_id) VALUES (v_tenant_id);
  INSERT INTO tenant_billing_settings (tenant_id) VALUES (v_tenant_id);

  IF p_superadmin_user_id IS NOT NULL THEN
    INSERT INTO user_tenants (user_id, tenant_id, role)
    VALUES (p_superadmin_user_id, v_tenant_id, 'owner')
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  END IF;

  IF p_owner_user_id IS NOT NULL THEN
    INSERT INTO user_tenants (user_id, tenant_id, role)
    VALUES (p_owner_user_id, v_tenant_id, 'owner')
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_tenant_id, v_license_key;
END;
$$;

-- Tell PostgREST to reload its cache so the new function signature is picked up.
NOTIFY pgrst, 'reload schema';
