-- ───────────────────────────────────────────────────────────────────────────
-- 0093 — Layaway terms (a shop's saved layaway plans)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0092.
--
-- Most shops write every layaway on the same terms. A row here is one named
-- plan ("90 days · 20% down"): payment schedule, down payment as a share of
-- the total, days until the first payment, days until it must be paid off,
-- and the cancellation fee. Settings → Layaway terms edits the list and marks
-- one as the default. The New layaway dialog turns the picked plan into the
-- same values a clerk types today (dates counted from today in the shop's
-- timezone), so `layaways` and layaway_create() do not change. "Custom" in
-- that dialog still lets the clerk type everything by hand.
--
-- Fractions, like layaways.cancellation_fee_pct: 0.2000 = 20%.
-- Nothing is seeded — each shop starts with an empty list.
--
-- RLS (NEW policies on the NEW table only — no existing policy changes):
--   layaway_terms_staff_read     SELECT for staff of the tenant
--   layaway_terms_manager_write  ALL for owners (incl. chain admins via
--                                my_is_owner) and managers
-- Same two rules as quick_sale_buttons (0081).
--
-- Rollback
--   DROP TABLE IF EXISTS layaway_terms;
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS layaway_terms (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  schedule_kind         TEXT NOT NULL
                          CHECK (schedule_kind IN ('weekly','biweekly','monthly','custom')),
  -- Minimum down payment as a share of the layaway total.
  down_payment_pct      NUMERIC(6,4) NOT NULL DEFAULT 0
                          CHECK (down_payment_pct >= 0 AND down_payment_pct <= 1),
  -- Days from the day the layaway is opened.
  first_payment_days    INTEGER NOT NULL CHECK (first_payment_days BETWEEN 1 AND 366),
  term_days             INTEGER NOT NULL CHECK (term_days BETWEEN 1 AND 1096),
  cancellation_fee_pct  NUMERIC(6,4) NOT NULL DEFAULT 0
                          CHECK (cancellation_fee_pct >= 0 AND cancellation_fee_pct <= 1),
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  position              INTEGER NOT NULL DEFAULT 0,
  created_by            UUID REFERENCES auth.users(id),
  updated_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT layaway_terms_first_within_term CHECK (first_payment_days <= term_days),
  -- The default is what the dialog opens on, so it must be usable.
  CONSTRAINT layaway_terms_default_usable
    CHECK (NOT is_default OR (is_active AND deleted_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_layaway_terms_tenant
  ON layaway_terms (tenant_id, position) WHERE deleted_at IS NULL;

-- At most one default per shop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_layaway_terms_default
  ON layaway_terms (tenant_id) WHERE is_default;

DROP TRIGGER IF EXISTS trg_layaway_terms_updated_at ON layaway_terms;
CREATE TRIGGER trg_layaway_terms_updated_at BEFORE UPDATE ON layaway_terms
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE layaway_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS layaway_terms_staff_read ON layaway_terms;
CREATE POLICY layaway_terms_staff_read ON layaway_terms FOR SELECT
  USING (tenant_id IN (SELECT my_accessible_tenant_ids()) AND my_is_staff(tenant_id));

DROP POLICY IF EXISTS layaway_terms_manager_write ON layaway_terms;
CREATE POLICY layaway_terms_manager_write ON layaway_terms FOR ALL
  USING (my_is_owner(tenant_id) OR my_role_in_tenant(tenant_id) = 'manager')
  WITH CHECK (my_is_owner(tenant_id) OR my_role_in_tenant(tenant_id) = 'manager');

REVOKE ALL ON layaway_terms FROM anon;

NOTIFY pgrst, 'reload schema';
