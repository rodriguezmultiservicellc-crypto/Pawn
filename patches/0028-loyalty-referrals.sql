-- ───────────────────────────────────────────────────────────────────────────
-- 0028 — loyalty + referrals (Phase 10 Path A, slice 3)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0027 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds a per-tenant customer-loyalty + referral system:
--
--     customers + 4 columns:
--       loyalty_points_balance INTEGER NOT NULL DEFAULT 0  CHECK (>= 0)
--       referral_code          TEXT
--       referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL
--       referral_credited      BOOLEAN NOT NULL DEFAULT FALSE
--
--     settings + 5 columns (gate + rates):
--       loyalty_enabled                  BOOLEAN NOT NULL DEFAULT FALSE
--       loyalty_earn_rate_retail         NUMERIC(8,4) NOT NULL DEFAULT 1   CHECK (>= 0)
--       loyalty_earn_rate_loan_interest  NUMERIC(8,4) NOT NULL DEFAULT 1   CHECK (>= 0)
--       loyalty_redemption_rate          NUMERIC(8,4) NOT NULL DEFAULT 100 CHECK (>  0)
--       loyalty_referral_bonus           INTEGER       NOT NULL DEFAULT 500 CHECK (>= 0)
--
--     loyalty_events (NEW table) — append-only event log:
--       id, tenant_id, customer_id, kind (7-value CHECK enum),
--       points_delta INT, source_kind, source_id, reason, performed_by,
--       created_at
--
--   Three triggers:
--     - trg_loyalty_events_apply_balance: AFTER INSERT, applies the delta to
--       customers.loyalty_points_balance. SECURITY DEFINER + locked search_path
--       per Session 9 rule.
--     - trg_loyalty_events_block_mutation: BEFORE UPDATE OR DELETE on
--       loyalty_events, raises exception. Append-only at the DB.
--     - trg_customers_referral_same_tenant: BEFORE INSERT OR UPDATE OF
--       referred_by_customer_id on customers, ensures referrer is in the same
--       tenant. Defense-in-depth — app code already gates by tenant_id.
--
--   Two indexes on loyalty_events:
--     - idx_loyalty_events_customer_created (customer_id, created_at DESC)
--       for the activity log on customer + portal pages
--     - idx_loyalty_events_tenant for tenant-scoped reads
--
--   One UNIQUE partial idempotency index on
--     (customer_id, source_kind, source_id, kind)
--   WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
--     AND kind IN ('earn_sale','earn_loan_interest','earn_referral_bonus','earn_clawback')
--   Manual + redeem + undo events are intentionally excluded so multiple
--   redemptions per sale and repeated manual adjustments are allowed.
--
--   One UNIQUE partial index on customers (tenant_id, referral_code)
--   WHERE referral_code IS NOT NULL — per-tenant code uniqueness.
--
-- RLS
--
--   loyalty_events: staff SELECT/INSERT in their tenant via my_tenant_ids().
--   New columns on customers + settings inherit existing tenant-scoped policies.
--   Customer portal sees own events via existing customer-self policies.
--
-- Why settings (not tenants) for the gate
--
--   settings is already 1:1 with tenants and already houses module-y per-tenant
--   defaults (default_loan_interest_rate, buy_hold_period_days). Loyalty rides
--   on top of existing modules — not its own module flag like has_pawn.
--
-- Forward-only earning
--
--   No backfill. loyalty_points_balance defaults to 0 for all existing
--   customers. Points only accrue on transactions completed AFTER the
--   operator flips loyalty_enabled.
--
-- Followups (NOT in this patch)
--
--   - Run `npm run db:types` after applying so src/types/database.ts
--     picks up the new columns.
--   - Application-layer hooks land in the same PR.
--
-- Rollback
--
--   DROP TRIGGER IF EXISTS trg_customers_referral_same_tenant ON customers;
--   DROP FUNCTION IF EXISTS customers_referral_same_tenant();
--   DROP TRIGGER IF EXISTS trg_loyalty_events_block_mutation ON loyalty_events;
--   DROP FUNCTION IF EXISTS loyalty_events_block_mutation();
--   DROP TRIGGER IF EXISTS trg_loyalty_events_apply_balance ON loyalty_events;
--   DROP FUNCTION IF EXISTS loyalty_events_apply_balance();
--   DROP INDEX IF EXISTS loyalty_events_idempotency;
--   DROP INDEX IF EXISTS idx_loyalty_events_tenant;
--   DROP INDEX IF EXISTS idx_loyalty_events_customer_created;
--   DROP TABLE IF EXISTS loyalty_events;
--   DROP INDEX IF EXISTS customers_referral_code_unique;
--   ALTER TABLE settings
--     DROP COLUMN IF EXISTS loyalty_referral_bonus,
--     DROP COLUMN IF EXISTS loyalty_redemption_rate,
--     DROP COLUMN IF EXISTS loyalty_earn_rate_loan_interest,
--     DROP COLUMN IF EXISTS loyalty_earn_rate_retail,
--     DROP COLUMN IF EXISTS loyalty_enabled;
--   ALTER TABLE customers
--     DROP COLUMN IF EXISTS referral_credited,
--     DROP COLUMN IF EXISTS referred_by_customer_id,
--     DROP COLUMN IF EXISTS referral_code,
--     DROP COLUMN IF EXISTS loyalty_points_balance;
-- ============================================================================

-- ── customers columns ─────────────────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points_balance INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_points_balance >= 0),
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_customer_id UUID
    REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_credited BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN customers.loyalty_points_balance IS
  'Materialized loyalty points balance. Maintained by the trg_loyalty_events_apply_balance trigger on loyalty_events INSERT. CHECK (>= 0) is the safety net — a delta that would drop the balance below zero rolls back the parent transaction.';
COMMENT ON COLUMN customers.referral_code IS
  '6-char A-Z + digits 2-9 (no I/O/0/1) referral code. Per-tenant unique via partial index. Lazily generated by ensureReferralCode helper.';
COMMENT ON COLUMN customers.referred_by_customer_id IS
  'The customer in the same tenant whose referral code this customer signed up under. Same-tenant constraint enforced by trg_customers_referral_same_tenant.';
COMMENT ON COLUMN customers.referral_credited IS
  'Flips TRUE the first time a referral bonus is awarded for this referred customer. Defense-in-depth alongside the loyalty_events_idempotency partial unique index.';

CREATE UNIQUE INDEX IF NOT EXISTS customers_referral_code_unique
  ON customers (tenant_id, referral_code)
  WHERE referral_code IS NOT NULL;

-- ── settings columns ──────────────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS loyalty_earn_rate_retail NUMERIC(8,4) NOT NULL DEFAULT 1
    CHECK (loyalty_earn_rate_retail >= 0),
  ADD COLUMN IF NOT EXISTS loyalty_earn_rate_loan_interest NUMERIC(8,4) NOT NULL DEFAULT 1
    CHECK (loyalty_earn_rate_loan_interest >= 0),
  ADD COLUMN IF NOT EXISTS loyalty_redemption_rate NUMERIC(8,4) NOT NULL DEFAULT 100
    CHECK (loyalty_redemption_rate > 0),
  ADD COLUMN IF NOT EXISTS loyalty_referral_bonus INTEGER NOT NULL DEFAULT 500
    CHECK (loyalty_referral_bonus >= 0);

COMMENT ON COLUMN settings.loyalty_enabled IS
  'Master gate for the loyalty + referrals surface. When FALSE, no earn / redeem / referral events fire and the staff loyalty panel + portal /loyalty surface hide.';
COMMENT ON COLUMN settings.loyalty_earn_rate_retail IS
  'Points awarded per $1 of retail sale subtotal (NOT total — no points on tax). Default 1 pt/$1.';
COMMENT ON COLUMN settings.loyalty_earn_rate_loan_interest IS
  'Points awarded per $1 of loan interest paid (the actual shop revenue). Default 1 pt/$1.';
COMMENT ON COLUMN settings.loyalty_redemption_rate IS
  'Points required per $1 of discount. Default 100 (1 pt = $0.01). MUST be > 0 — divide-by-zero in computeRedemptionDiscount otherwise.';
COMMENT ON COLUMN settings.loyalty_referral_bonus IS
  'Flat points awarded to referrer on referred customer''s first qualifying transaction (sale or loan redemption with interest). Default 500.';

-- ── loyalty_events table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN (
    'earn_sale',
    'earn_loan_interest',
    'earn_referral_bonus',
    'redeem_pos',
    'redeem_undo',
    'earn_clawback',
    'adjust_manual'
  )),
  points_delta  INTEGER NOT NULL,
  source_kind   TEXT,
  source_id     UUID,
  reason        TEXT,
  performed_by  UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE loyalty_events IS
  'Append-only log of loyalty point events. Updates and deletes are blocked by trg_loyalty_events_block_mutation. Negative-delta events (redeem_pos, earn_clawback, manual debits) join positive ones in the same log; the materialized balance on customers is maintained by trg_loyalty_events_apply_balance.';

CREATE INDEX IF NOT EXISTS idx_loyalty_events_customer_created
  ON loyalty_events (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_tenant
  ON loyalty_events (tenant_id);

-- Idempotency on the auto-credit kinds. earn_clawback joins the set so each
-- (sale_id, kind='earn_clawback', source_kind='sale') and each
-- (return_id, kind='earn_clawback', source_kind='return') can only insert once.
-- redeem_pos, redeem_undo, adjust_manual stay outside the index — duplicates
-- are intentionally allowed (multi-redemption per sale, repeat undos, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_events_idempotency
  ON loyalty_events (customer_id, source_kind, source_id, kind)
  WHERE source_kind IS NOT NULL
    AND source_id IS NOT NULL
    AND kind IN (
      'earn_sale',
      'earn_loan_interest',
      'earn_referral_bonus',
      'earn_clawback'
    );

-- ── Trigger: balance maintenance (AFTER INSERT) ───────────────────────────
CREATE OR REPLACE FUNCTION loyalty_events_apply_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE customers
     SET loyalty_points_balance = loyalty_points_balance + NEW.points_delta,
         updated_at = NOW()
   WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_events_apply_balance ON loyalty_events;
CREATE TRIGGER trg_loyalty_events_apply_balance
  AFTER INSERT ON loyalty_events
  FOR EACH ROW EXECUTE FUNCTION loyalty_events_apply_balance();

-- ── Trigger: append-only enforcement (BEFORE UPDATE OR DELETE) ────────────
CREATE OR REPLACE FUNCTION loyalty_events_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'loyalty_events is append-only — write a compensating event instead'
    USING ERRCODE = '23000';
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_events_block_mutation ON loyalty_events;
CREATE TRIGGER trg_loyalty_events_block_mutation
  BEFORE UPDATE OR DELETE ON loyalty_events
  FOR EACH ROW EXECUTE FUNCTION loyalty_events_block_mutation();

-- ── Trigger: same-tenant referral guard (BEFORE INSERT OR UPDATE) ─────────
CREATE OR REPLACE FUNCTION customers_referral_same_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.referred_by_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM customers
       WHERE id = NEW.referred_by_customer_id
         AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'referred_by_customer_id must belong to the same tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_referral_same_tenant ON customers;
CREATE TRIGGER trg_customers_referral_same_tenant
  BEFORE INSERT OR UPDATE OF referred_by_customer_id ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_referral_same_tenant();

-- ── RLS on loyalty_events ─────────────────────────────────────────────────
ALTER TABLE loyalty_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_events_staff_select ON loyalty_events;
CREATE POLICY loyalty_events_staff_select ON loyalty_events
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT my_tenant_ids()));

-- Staff INSERT: tenant scope + performed_by must be NULL (system-fired
-- earn / clawback / referral events) OR equal auth.uid() (staff-fired
-- redeem / undo / adjust). Defense-in-depth: app code routes writes
-- through the admin client (which bypasses RLS), but if a future code
-- path uses a user-scoped client this policy prevents staff from
-- forging audit attribution to another user.
DROP POLICY IF EXISTS loyalty_events_staff_insert ON loyalty_events;
CREATE POLICY loyalty_events_staff_insert ON loyalty_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT my_tenant_ids())
    AND (performed_by IS NULL OR performed_by = auth.uid())
  );

-- Customer-portal SELECT: a client member can read their own customer's events.
-- Mirrors the customer-self-read pattern already in place (see 0009).
DROP POLICY IF EXISTS loyalty_events_portal_select ON loyalty_events;
CREATE POLICY loyalty_events_portal_select ON loyalty_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = loyalty_events.customer_id
        AND c.auth_user_id = auth.uid()
    )
  );

-- Tell PostgREST to pick up the new columns + table + policies without restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0028-loyalty-referrals.sql
-- ============================================================================
