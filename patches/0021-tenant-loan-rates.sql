-- ───────────────────────────────────────────────────────────────────────────
-- 0021 — Tenant loan rates (variable interest-rate menu)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0020 has already run.
--           Append-only — never edit prior migrations.
--
-- Replaces the free-form interest_rate_monthly input on /pawn/new with a
-- per-tenant configurable dropdown. Operators can configure their menu
-- of standard rates (e.g. "10% standard", "15% high-risk", "5% repeat
-- customer") at /settings/loan-rates and pick from the menu at intake.
--
-- Backward compatibility:
--   - loans.interest_rate_monthly stays as-is. Each row records the
--     EFFECTIVE rate the loan was issued at. Picking from the menu just
--     copies the rate value into that column at intake.
--   - When a tenant has no configured rates (brand-new tenants between
--     migration apply and first config save), the pawn-new form falls
--     back to the existing number input.
--
-- Seed: every existing tenant gets one default 10%/mo row marked
-- is_default=TRUE so the form has something to render right away.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_loan_rates (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Monthly rate as a decimal: 0.10 = 10%/mo. Same shape as
  -- loans.interest_rate_monthly so the value copies cleanly.
  rate_monthly    NUMERIC(6,4) NOT NULL CHECK (rate_monthly >= 0 AND rate_monthly <= 0.25),
  -- Operator-facing label: "10% standard", "15% high-risk".
  label           TEXT         NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  -- Optional longer description shown below the dropdown.
  description     TEXT,
  -- Sort order in the dropdown. Lower numbers appear first.
  sort_order      INTEGER      NOT NULL DEFAULT 100,
  -- Exactly one row per tenant should have is_default = TRUE. Enforced
  -- via partial unique index below.
  is_default      BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Soft-disable lets operators retire rates without losing audit
  -- trail. Disabled rates don't appear in the picker but stay readable
  -- on existing loans.
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by      UUID         REFERENCES auth.users(id),
  updated_by      UUID         REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_loan_rates_tenant
  ON tenant_loan_rates(tenant_id)
  WHERE is_active = TRUE;

-- Exactly-one-default-per-tenant invariant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_loan_rates_default
  ON tenant_loan_rates(tenant_id)
  WHERE is_default = TRUE;

-- No duplicate (tenant, rate, label) trios — keeps the picker clean.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_loan_rates_unique
  ON tenant_loan_rates(tenant_id, rate_monthly, label)
  WHERE is_active = TRUE;

-- ───────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────
-- Read: any staff role at the tenant (the pawn intake form needs it).
-- Write: owner / chain_admin / manager via /settings/loan-rates.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_loan_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_loan_rates_staff_read ON tenant_loan_rates;
CREATE POLICY tenant_loan_rates_staff_read ON tenant_loan_rates FOR SELECT
  USING (my_is_staff(tenant_id));

DROP POLICY IF EXISTS tenant_loan_rates_owner_write ON tenant_loan_rates;
CREATE POLICY tenant_loan_rates_owner_write ON tenant_loan_rates FOR ALL
  USING (
    my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager')
  )
  WITH CHECK (
    my_role_in_tenant(tenant_id) IN ('owner','chain_admin','manager')
  );

-- ───────────────────────────────────────────────────────────────────────────
-- SEED — one default rate per existing tenant (10%/mo, the prior
-- form default). Idempotent: no-op if a default row already exists.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tenant_loan_rates (
  tenant_id, rate_monthly, label, description, sort_order, is_default
)
SELECT
  t.id,
  0.10,
  'Standard 10% / month',
  'Default rate seeded by migration 0021. Edit at /settings/loan-rates.',
  100,
  TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_loan_rates r
  WHERE r.tenant_id = t.id AND r.is_default = TRUE
);
