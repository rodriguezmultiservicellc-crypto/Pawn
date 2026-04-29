-- ───────────────────────────────────────────────────────────────────────────
-- 0022 — Loan rate minimums (per-rate min monthly charge + tenant-wide min loan amount)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0021 has already run.
--           Append-only — never edit prior migrations.
--
-- Two related but independent knobs operators were asking for:
--
--   1. Per-rate minimum MONTHLY interest charge.
--      A rate row of "10% / month" applied to a $10 collateral loan would
--      otherwise charge $1/month interest. If the company's monthly
--      interest floor is $20, set min_monthly_charge=20 on that rate row
--      and the math helper floors monthly accrual at $20 (applied per-day
--      as $20/30 = $0.667/day, so a 15-day redemption pays $10 not $20).
--
--   2. Tenant-wide minimum LOAN AMOUNT.
--      Operators who refuse to write loans under $X (e.g. $25) configure
--      it once per tenant on /settings/loan-rates. /pawn/new rejects with
--      a clear error before validation if principal < settings.
--      min_loan_amount.
--
-- Both new columns are nullable. NULL = "no floor configured" so existing
-- tenants are untouched until an operator opts in.
-- ───────────────────────────────────────────────────────────────────────────

-- Per-rate minimum monthly interest charge.
ALTER TABLE tenant_loan_rates
  ADD COLUMN IF NOT EXISTS min_monthly_charge NUMERIC(18,4) NULL
    CHECK (min_monthly_charge IS NULL OR min_monthly_charge >= 0);

COMMENT ON COLUMN tenant_loan_rates.min_monthly_charge IS
  'Optional floor on monthly interest. When set, monthly interest = '
  'GREATEST(principal * rate_monthly, min_monthly_charge). Applied per-day '
  'as min_monthly_charge / 30 so partial-month redemptions pro-rate '
  'cleanly. NULL = no floor.';

-- Snapshot column on loans so each loan freezes the floor at intake. If
-- the operator later edits the rate, in-flight loans keep their original
-- minimum (same pattern as interest_rate_monthly being snapshotted).
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS min_monthly_charge NUMERIC(18,4) NULL
    CHECK (min_monthly_charge IS NULL OR min_monthly_charge >= 0);

COMMENT ON COLUMN loans.min_monthly_charge IS
  'Snapshot of tenant_loan_rates.min_monthly_charge at intake. Frozen for '
  'the life of the loan so rate-menu edits never alter existing loans.';

-- Tenant-wide minimum loan amount.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS min_loan_amount NUMERIC(18,4) NULL
    CHECK (min_loan_amount IS NULL OR min_loan_amount >= 0);

COMMENT ON COLUMN settings.min_loan_amount IS
  'Optional minimum loan principal. /pawn/new rejects intake when '
  'principal < min_loan_amount. NULL = no minimum (operator will write '
  'any size loan).';
