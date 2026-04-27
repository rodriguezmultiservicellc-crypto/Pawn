-- ============================================================================
-- PAWN — PAWN LOANS MIGRATION (Phase 2)
-- File:    patches/0005-pawn-loans.sql
-- Date:    2026-04-27
-- Purpose: Pawn loans, collateral item snapshots, loan event log,
--          compliance_log INSERT policy + per-tenant compliance rows for the
--          police-report exporter.
--
-- Apply to: existing project AFTER 0001 / 0002 / 0003 / 0004 have run.
-- Append-only — never edit prior migrations.
--
-- Design notes:
--   - loans.ticket_number is per-tenant monotonic ('PT-' + 6-digit pad),
--     assigned by trigger via next_tenant_counter('loan_ticket') from 0003.
--   - loan_collateral_items is a SNAPSHOT — frozen at intake. No FK back to
--     inventory_items because pawned items don't enter inventory until
--     forfeiture. On forfeit, the forfeitLoanAction in the app layer copies
--     each row into inventory_items with source='pawn_forfeit' and
--     source_loan_id = loan.id.
--   - loan_events is the source of truth for payment / extension /
--     redemption / forfeit / void history. Loan balance is computed by
--     summing events against principal + accrued interest in lib/pawn/math.
--   - Pawn ticket immutability after print: Rule 14 from CLAUDE.md. Once
--     loans.is_printed = TRUE, a BEFORE UPDATE trigger blocks changes to
--     (principal, interest_rate_monthly, term_days, customer_id, due_date).
--     Status changes still allowed (so redemption / extension / forfeit /
--     void can still proceed post-print).
--   - Tenant scoping: every table includes tenant_id (NOT NULL FK) +
--     created_at + updated_at + deleted_at. Soft-delete only — financial
--     records never hard-deleted.
--   - compliance_log: rows already exist from 0001-foundation.sql. This
--     migration adds the staff INSERT policy so server actions running
--     under the user-scoped client can write intake snapshots. There is
--     deliberately NO UPDATE policy — the write-once trigger in 0001
--     blocks updates anyway, but we ALSO don't grant the policy. SELECT
--     for staff is already in 0001.
--   - Money: numeric(18,4). Interest rate: numeric(6,4) (e.g. 0.1000 = 10%).
--     Metal weights: numeric(10,4) grams. Karat: numeric(4,1) (e.g. 14.0).
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
--  ENUMS
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE loan_status AS ENUM (
    'active',         -- issued, within term
    'extended',       -- extended once or more, still on the floor
    'partial_paid',   -- some interest/principal paid, balance remains
    'redeemed',       -- fully paid off, collateral released
    'forfeited',      -- defaulted, collateral converted to inventory
    'voided'          -- mistake / fraud / cancellation; not a redemption
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE loan_event_type AS ENUM (
    'issued',
    'payment',
    'extension',
    'redemption',
    'forfeiture',
    'void'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'cash',
    'card',
    'check',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  LOANS
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loans (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Customer
  customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  -- Ticket number: per-tenant monotonic, 'PT-' + 6-digit pad. Trigger
  -- assigns via next_tenant_counter() when ticket_number is NULL on INSERT.
  ticket_number           TEXT,

  -- Loan terms
  principal               NUMERIC(18,4) NOT NULL CHECK (principal > 0),
  interest_rate_monthly   NUMERIC(6,4) NOT NULL CHECK (interest_rate_monthly >= 0 AND interest_rate_monthly <= 1),
  term_days               INTEGER NOT NULL CHECK (term_days BETWEEN 1 AND 365),
  issue_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date                DATE NOT NULL,

  -- Lifecycle
  status                  loan_status NOT NULL DEFAULT 'active',
  is_printed              BOOLEAN NOT NULL DEFAULT FALSE,
  printed_at              TIMESTAMPTZ,

  -- Renewals: when a loan is renewed (Phase 2 future work), source_loan_id
  -- points back to the previous loan. NULL on first issue.
  source_loan_id          UUID REFERENCES loans(id) ON DELETE SET NULL,

  -- Customer-signed signature image (Storage path, signed URL on read).
  -- Bucket: customer-documents (same RLS as ID scans / signatures).
  signature_path          TEXT,

  -- Free-form
  notes                   TEXT,

  -- Audit / soft-delete
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),

  UNIQUE (tenant_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_loans_tenant            ON loans(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loans_tenant_status_due ON loans(tenant_id, status, due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loans_customer          ON loans(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loans_source_loan       ON loans(source_loan_id) WHERE source_loan_id IS NOT NULL;

-- BEFORE INSERT: assign ticket_number when blank.
CREATE OR REPLACE FUNCTION loans_assign_ticket_number()
RETURNS TRIGGER AS $$
DECLARE v_seq BIGINT;
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    v_seq := next_tenant_counter(NEW.tenant_id, 'loan_ticket');
    NEW.ticket_number := 'PT-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_loans_ticket_number ON loans;
CREATE TRIGGER trg_loans_ticket_number
BEFORE INSERT ON loans
FOR EACH ROW EXECUTE FUNCTION loans_assign_ticket_number();

-- BEFORE UPDATE: enforce pawn ticket immutability after print (Rule 14).
-- Once is_printed flipped TRUE, the core economic terms freeze. Status
-- changes still permitted so redemption / extension / forfeit / void can
-- still proceed and update due_date is allowed AS LONG AS status is also
-- transitioning to 'extended' (extension flow). Other due_date edits blocked.
CREATE OR REPLACE FUNCTION loans_enforce_print_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_printed = TRUE THEN
    IF NEW.principal              IS DISTINCT FROM OLD.principal THEN
      RAISE EXCEPTION 'loans.principal is immutable after the ticket is printed (loan %).', OLD.id;
    END IF;
    IF NEW.interest_rate_monthly  IS DISTINCT FROM OLD.interest_rate_monthly THEN
      RAISE EXCEPTION 'loans.interest_rate_monthly is immutable after the ticket is printed (loan %).', OLD.id;
    END IF;
    IF NEW.customer_id            IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'loans.customer_id is immutable after the ticket is printed (loan %).', OLD.id;
    END IF;
    -- term_days + due_date are immutable EXCEPT when the new status is
    -- 'extended' (legitimate extension flow rewrites both fields). The
    -- extension server action always sets status='extended' before the
    -- UPDATE, so the trigger sees NEW.status = 'extended' and allows the
    -- due_date / term_days rewrite.
    IF NEW.status IS DISTINCT FROM 'extended' THEN
      IF NEW.term_days IS DISTINCT FROM OLD.term_days THEN
        RAISE EXCEPTION 'loans.term_days is immutable after the ticket is printed except via extension (loan %).', OLD.id;
      END IF;
      IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'loans.due_date is immutable after the ticket is printed except via extension (loan %).', OLD.id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_loans_print_immutability ON loans;
CREATE TRIGGER trg_loans_print_immutability
BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION loans_enforce_print_immutability();

DROP TRIGGER IF EXISTS trg_loans_updated_at ON loans;
CREATE TRIGGER trg_loans_updated_at BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
--  LOAN COLLATERAL ITEMS — frozen-at-intake snapshot.
-- ───────────────────────────────────────────────────────────────────────────
-- These are NOT inventory_items. Pawned items only become inventory on
-- forfeiture. Photo lives in the inventory-photos bucket under the loan
-- folder; the forfeit hook re-links the path to the new inventory_items row.

CREATE TABLE IF NOT EXISTS loan_collateral_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id         UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  description     TEXT NOT NULL,
  category        inventory_category NOT NULL DEFAULT 'other',
  metal_type      metal_type,
  karat           NUMERIC(4,1),
  weight_grams    NUMERIC(10,4),
  est_value       NUMERIC(18,4) NOT NULL DEFAULT 0,

  -- Storage path WITHIN the inventory-photos bucket. Convention:
  -- '<tenant_id>/loans/<loan_id>/<uuid>.<ext>'
  photo_path      TEXT,

  position        INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_loan_collateral_loan   ON loan_collateral_items(loan_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loan_collateral_tenant ON loan_collateral_items(tenant_id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  LOAN EVENTS — payment / extension / redemption / forfeit / void log.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loan_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id           UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  event_type        loan_event_type NOT NULL,
  -- For 'payment' and 'redemption': total amount collected this event.
  -- For 'issued': principal disbursed (mirror of loans.principal).
  -- For 'extension': interest collected in cash this event (0 if none).
  -- For 'forfeiture' / 'void': null.
  amount            NUMERIC(18,4),

  -- Split fields (apply to 'payment' / 'redemption'). Zero on other events.
  principal_paid    NUMERIC(18,4) NOT NULL DEFAULT 0,
  interest_paid     NUMERIC(18,4) NOT NULL DEFAULT 0,
  fees_paid         NUMERIC(18,4) NOT NULL DEFAULT 0,

  payment_method    payment_method,

  -- Set on 'extension' events; mirrors the new loan.due_date that the
  -- corresponding UPDATE on loans wrote.
  new_due_date      DATE,

  notes             TEXT,
  performed_by      UUID REFERENCES auth.users(id),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT loan_events_split_signs CHECK (
    principal_paid >= 0 AND interest_paid >= 0 AND fees_paid >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_loan_events_loan       ON loan_events(loan_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_events_tenant     ON loan_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_events_type       ON loan_events(loan_id, event_type);

-- ───────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE loans                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_collateral_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_events            ENABLE ROW LEVEL SECURITY;

-- ── loans
DROP POLICY IF EXISTS loans_staff_read ON loans;
CREATE POLICY loans_staff_read ON loans FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS loans_staff_write ON loans;
CREATE POLICY loans_staff_write ON loans FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── loan_collateral_items
DROP POLICY IF EXISTS loan_collateral_staff_read ON loan_collateral_items;
CREATE POLICY loan_collateral_staff_read ON loan_collateral_items FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS loan_collateral_staff_write ON loan_collateral_items;
CREATE POLICY loan_collateral_staff_write ON loan_collateral_items FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── loan_events
DROP POLICY IF EXISTS loan_events_staff_read ON loan_events;
CREATE POLICY loan_events_staff_read ON loan_events FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

DROP POLICY IF EXISTS loan_events_staff_write ON loan_events;
CREATE POLICY loan_events_staff_write ON loan_events FOR ALL
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  )
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- ── compliance_log: 0001 created the SELECT policy + the immutability
-- trigger. We add the INSERT policy so server actions running under the
-- user-scoped client can write intake snapshots. NO UPDATE POLICY — the
-- write-once trigger blocks updates anyway and we don't grant a policy
-- that would imply otherwise.
DROP POLICY IF EXISTS compliance_log_staff_insert ON compliance_log;
CREATE POLICY compliance_log_staff_insert ON compliance_log FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0005-pawn-loans.sql
-- ============================================================================
