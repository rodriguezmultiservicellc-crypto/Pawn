-- ───────────────────────────────────────────────────────────────────────────
-- 0081 — Quick sale buttons (POS "Ledger" layout)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0080.
--
-- A shop's preset POS items: a name and a price per button ("Battery
-- swap · $15"). Tapping one on New sale adds an ordinary custom line with
-- that name and price; the sale itself is saved exactly as a custom line
-- is today, so no sale table changes. Nothing is seeded — each shop
-- starts with an empty list.
--
-- RLS (NEW policies on the NEW table only — no existing policy changes):
--   quick_sale_buttons_staff_read     SELECT for staff of the tenant
--   quick_sale_buttons_manager_write  ALL for owners (incl. chain admins via
--                                     my_is_owner) and managers
--
-- Rollback
--   DROP TABLE IF EXISTS quick_sale_buttons;
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quick_sale_buttons (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  price       NUMERIC(18,4) NOT NULL CHECK (price >= 0 AND price <= 1000000),
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quick_sale_buttons_tenant
  ON quick_sale_buttons (tenant_id, position) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_quick_sale_buttons_updated_at ON quick_sale_buttons;
CREATE TRIGGER trg_quick_sale_buttons_updated_at BEFORE UPDATE ON quick_sale_buttons
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE quick_sale_buttons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_sale_buttons_staff_read ON quick_sale_buttons;
CREATE POLICY quick_sale_buttons_staff_read ON quick_sale_buttons FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS quick_sale_buttons_manager_write ON quick_sale_buttons;
CREATE POLICY quick_sale_buttons_manager_write ON quick_sale_buttons FOR ALL
  USING (my_is_owner(tenant_id) OR my_role_in_tenant(tenant_id) = 'manager')
  WITH CHECK (my_is_owner(tenant_id) OR my_role_in_tenant(tenant_id) = 'manager');

REVOKE ALL ON quick_sale_buttons FROM anon;

NOTIFY pgrst, 'reload schema';
