-- ───────────────────────────────────────────────────────────────────────────
-- 0094 — Sales tax by district (state + county + city …)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0093.
--
-- A shop's sales tax is a stack of rates set by different governments: the
-- state, the county, sometimes a city or a special district. A row here is
-- one of them ("Florida · state · 6%", "Hillsborough County · county · 1.5%").
-- Settings → Sales tax edits the list.
--
-- The rate a sale is charged is the SUM of the active rows. That total is
-- kept in settings.default_tax_rate by the trigger below — the column the
-- online store already reads (0078) and the POS now pre-fills its Tax field
-- from. One number, one owner: after this patch NOTHING writes
-- settings.default_tax_rate except this trigger.
--
-- Fractions, NUMERIC(6,4) like every tax rate in the schema: 0.0150 = 1.5%.
-- (Rates finer than a hundredth of a percent — 8.875% — do not fit; the app
-- refuses them instead of rounding.)
--
-- Nothing is seeded except: a shop that already had a single online-store
-- rate gets it back as one row, so its total does not change.
--
-- RLS (NEW policies on the NEW table only — no existing policy changes):
--   tax_rates_staff_read   SELECT for staff of the tenant (the POS shows
--                          the breakdown)
--   tax_rates_manager_write  ALL for owners (incl. chain admins via
--                            my_is_owner) and managers (Eddy, 2026-11-22)
-- The trigger function is SECURITY DEFINER: managers may not write
-- `settings` (owner-only RLS), and the total has to follow the list no
-- matter who edits it. It writes ONE column of ONE row — default_tax_rate
-- for the tenant of the row that changed — and refuses the whole change if
-- that row is missing.
--
-- Rollback
--   DROP TABLE IF EXISTS tax_rates;   -- leaves settings.default_tax_rate as is
--   DROP FUNCTION IF EXISTS tax_rates_sync_total();
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_rates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- Who levies it. Labels and ordering only; the math is the same.
  level       TEXT NOT NULL CHECK (level IN ('state','county','city','district','other')),
  rate        NUMERIC(6,4) NOT NULL CHECK (rate > 0 AND rate <= 1),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant
  ON tax_rates (tenant_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_tax_rates_updated_at ON tax_rates;
CREATE TRIGGER trg_tax_rates_updated_at BEFORE UPDATE ON tax_rates
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── The total lives in settings.default_tax_rate ──────────────────────────
CREATE OR REPLACE FUNCTION tax_rates_sync_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant UUID;
  v_total  NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
  ELSE
    v_tenant := NEW.tenant_id;
  END IF;

  SELECT COALESCE(SUM(rate), 0) INTO v_total
    FROM tax_rates
   WHERE tenant_id = v_tenant AND is_active AND deleted_at IS NULL;

  IF v_total > 1 THEN
    RAISE EXCEPTION 'tax_total_too_high' USING ERRCODE = 'P0001';
  END IF;

  UPDATE settings SET default_tax_rate = v_total WHERE tenant_id = v_tenant;
  IF NOT FOUND THEN
    -- No settings row: refuse the change rather than leave the list and
    -- the total out of step.
    RAISE EXCEPTION 'tax_total_not_saved' USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_rates_sync_total ON tax_rates;
CREATE TRIGGER trg_tax_rates_sync_total
AFTER INSERT OR UPDATE OR DELETE ON tax_rates
FOR EACH ROW EXECUTE FUNCTION tax_rates_sync_total();

-- A shop that already charged one rate online keeps it, as a single row.
INSERT INTO tax_rates (tenant_id, name, level, rate)
SELECT s.tenant_id, 'Sales tax', 'other', s.default_tax_rate
  FROM settings s
 WHERE s.default_tax_rate > 0
   AND NOT EXISTS (SELECT 1 FROM tax_rates t WHERE t.tenant_id = s.tenant_id);

COMMENT ON COLUMN settings.default_tax_rate IS
  'Total sales tax rate: the sum of the shop''s active tax_rates rows, kept by trg_tax_rates_sync_total (0094). Never write it directly. Pre-fills the POS Tax field and is charged on online orders picked up or shipped inside the shop''s state.';

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_rates_staff_read ON tax_rates;
CREATE POLICY tax_rates_staff_read ON tax_rates FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS tax_rates_manager_write ON tax_rates;
CREATE POLICY tax_rates_manager_write ON tax_rates FOR ALL
  USING (my_is_owner(tenant_id) OR my_role_in_tenant(tenant_id) = 'manager')
  WITH CHECK (my_is_owner(tenant_id) OR my_role_in_tenant(tenant_id) = 'manager');

REVOKE ALL ON tax_rates FROM anon;

NOTIFY pgrst, 'reload schema';
