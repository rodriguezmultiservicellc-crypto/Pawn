-- ───────────────────────────────────────────────────────────────────────────
-- 0017 — next_tenant_counter SECURITY DEFINER fix
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0016 has already run.
--           Append-only — never edit prior migrations.
--
-- Bug: 0003 created next_tenant_counter() as a plain plpgsql function. It
-- runs in the user's transaction (called from BEFORE INSERT triggers on
-- inventory_items / loans / repair_tickets / sales / etc.) and hits
-- INSERT/UPDATE on tenant_counters as the calling user. tenant_counters
-- has only a SELECT policy — design intent was "app-only writes (RPC)" —
-- so non-superadmin staff get:
--
--   new row violates row-level security policy for table "tenant_counters"
--
-- Fix: mark next_tenant_counter SECURITY DEFINER so it runs as the
-- function owner (postgres) and bypasses RLS, matching the documented
-- design. Set search_path explicitly per Postgres SECURITY DEFINER best
-- practice (prevents schema-resolution hijacks).
--
-- Same body as 0003 — only adds SECURITY DEFINER and SET search_path.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION next_tenant_counter(
  p_tenant_id     UUID,
  p_counter_name  TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE v_value BIGINT;
BEGIN
  INSERT INTO tenant_counters (tenant_id, counter_name, last_value)
  VALUES (p_tenant_id, p_counter_name, 1)
  ON CONFLICT (tenant_id, counter_name) DO UPDATE
    SET last_value = tenant_counters.last_value + 1,
        updated_at = NOW()
  RETURNING last_value INTO v_value;
  RETURN v_value;
END;
$$;

-- Lock down execution: revoke from PUBLIC, grant to authenticated only.
-- Triggers on tenant-scoped tables call this from authenticated sessions;
-- service_role inherits authenticated and gets it too.
REVOKE ALL ON FUNCTION next_tenant_counter(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_tenant_counter(UUID, TEXT) TO authenticated;
