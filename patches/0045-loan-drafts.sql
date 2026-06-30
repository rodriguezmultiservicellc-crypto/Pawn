-- ============================================================================
-- PAWN — LOAN DRAFTS (Phase 2 redesign, step 1: "Save as draft")
-- File:    patches/0045-loan-drafts.sql
-- Date:    2026-06-30
-- Purpose: A staging table for in-progress pawn intakes. Drafts are NOT loans:
--          they never touch the regulated `loans` table, never consume a
--          sequential PT- ticket number, and carry none of the loans CHECK
--          constraints (principal>0 / term 1-365 / due_date NOT NULL). When an
--          operator finalizes a draft, the normal createLoanAction runs and
--          does all the regulated work (ticket #, compliance_log, issue event);
--          the draft row is then soft-deleted.
--
-- Apply to: existing project AFTER 0005 (loans) has run. Append-only.
-- After apply: run `npm run db:types`.
--
-- Design notes:
--   - customer_id is REQUIRED (NOT NULL). The single hard requirement to save
--     a draft is "who is this for"; everything else is partial and lives in the
--     JSONB payload (principal / rate / term / dates / notes / collateral rows).
--   - payload is free-form intake state, intentionally schemaless so the
--     /pawn/new form can evolve without a migration per field. The server
--     action validates on FINALIZE (via loanCreateSchema), not on draft save.
--   - Soft-delete only (deleted_at) — consistent with every other scoped
--     table. A finalized or discarded draft is never hard-deleted.
--   - RLS mirrors the loans policies exactly (staff read+write, tenant-scoped
--     through my_accessible_tenant_ids() + my_is_staff()). NEW table, NEW
--     policies — this does not alter any existing isolation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS loan_drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Partial intake state. Shape (all optional except as the app enforces):
  --   { principal, interest_rate_monthly, min_monthly_charge, term_days,
  --     issue_date, due_date, rate_id, notes,
  --     collateral: [ { description, category, metal_type, karat,
  --                     weight_grams, est_value,
  --                     pawn_category_slug, pawn_subcategory_slug, ... } ] }
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_loan_drafts_tenant
  ON loan_drafts(tenant_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loan_drafts_customer
  ON loan_drafts(customer_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_loan_drafts_updated_at ON loan_drafts;
CREATE TRIGGER trg_loan_drafts_updated_at BEFORE UPDATE ON loan_drafts
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Row Level Security (mirrors loans; new table, new policies) ─────────────
ALTER TABLE loan_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loan_drafts_staff_read ON loan_drafts;
CREATE POLICY loan_drafts_staff_read ON loan_drafts FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS loan_drafts_staff_write ON loan_drafts;
CREATE POLICY loan_drafts_staff_write ON loan_drafts FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0045-loan-drafts.sql
-- ============================================================================
