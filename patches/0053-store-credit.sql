-- ───────────────────────────────────────────────────────────────────────────
-- 0053 — store credit (PawnSmarts parity, feature 4 of 4 — part A)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0052 has already run AND
--           COMMITTED. 0052 adds the 'store_credit' payment_method value;
--           this file uses it, and Postgres refuses both in one transaction.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   customers + 1 column:
--     store_credit_balance NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (>= 0)
--
--   settings + 2 columns:
--     store_credit_enabled       BOOLEAN NOT NULL DEFAULT FALSE
--     store_credit_expiry_days   INTEGER NULL CHECK (> 0)   -- informational
--
--   store_credit_events (NEW table) — append-only money ledger, the
--   loyalty_events pattern (0028) with NUMERIC(18,4) deltas instead of
--   integer points:
--     id, tenant_id, customer_id, kind (7-value CHECK enum),
--     amount_delta NUMERIC(18,4), source_kind, source_id, sale_payment_id,
--     reason, performed_by, created_at
--
--   Two triggers on store_credit_events:
--     - trg_store_credit_apply_balance  AFTER INSERT — applies the delta to
--       customers.store_credit_balance. SECURITY DEFINER + locked
--       search_path per the Session 9 rule.
--     - trg_store_credit_block_mutation BEFORE UPDATE OR DELETE — raises.
--       Append-only at the DB, same as loyalty_events. (A tenant hard-delete
--       would trip this; tenants soft-delete, and a future purge job has to
--       disable the trigger for BOTH ledgers.)
--
--   Three RPCs (service_role only — app guards run first, Rule 10):
--     - store_credit_redeem_on_sale(tenant, sale, amount, performed_by)
--       Writes the ledger debit AND the sale_payments row AND the
--       sales.paid_total roll-up in ONE transaction, so a POS tender can
--       never half-apply (credit taken but no payment recorded, or a
--       payment recorded against credit that was never debited).
--     - store_credit_undo_sale_redemption(tenant, event, performed_by)
--       Reverses one redemption on a still-open sale: soft-deletes the
--       payment row, backs out paid_total, writes the compensating event.
--     - store_credit_restore_for_sale(tenant, sale, performed_by)
--       Restores every un-undone redemption on a sale. Used by the void
--       path, which (like the card-refund path) LEAVES the payment rows in
--       place — a voided sale keeps its payment history.
--
--   Money amounts are numeric(18,4) per CLAUDE.md Rule 11. Every amount the
--   RPCs compute is ROUND(..., 4).
--
-- Why a materialized balance on customers
--
--   Same reasoning as loyalty_points_balance: the POS reads the balance on
--   every cart, and SUM() over the ledger on each read does not scale past
--   a few thousand events. The CHECK (>= 0) is the safety net — a debit
--   that would overdraw rolls the parent transaction back even if the app
--   check above it was wrong or raced.
--
-- Signs
--
--   issue_return / issue_buy / issue_manual / redeem_undo  → amount_delta > 0
--   redeem_pos / clawback                                  → amount_delta < 0
--   adjust_manual                                          → either, never 0
--   Enforced by a CHECK so a sign slip in app code cannot corrupt a balance.
--
-- Idempotency
--
--   UNIQUE partial index on (customer_id, source_kind, source_id, kind)
--   WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
--     AND kind IN ('issue_return','issue_buy','clawback','redeem_undo')
--   A double-submitted return cannot issue credit twice, and one redemption
--   cannot be undone twice. redeem_pos, issue_manual and adjust_manual sit
--   outside the index — several tenders per sale and repeated manual
--   adjustments are intentional.
--
-- RLS
--
--   store_credit_events: staff SELECT/INSERT within my_accessible_tenant_ids()
--   + my_is_staff(); the customer portal reads its own rows. Writes in the
--   app go through the RPCs (service_role), so the INSERT policy is
--   defense-in-depth for any future user-scoped path.
--
-- Followups (NOT in this patch)
--
--   - npm run db:types after applying.
--   - 0054-consignment.sql is part B of feature 4.
--
-- Rollback
--
--   DROP FUNCTION IF EXISTS store_credit_restore_for_sale(UUID, UUID, UUID);
--   DROP FUNCTION IF EXISTS store_credit_undo_sale_redemption(UUID, UUID, UUID);
--   DROP FUNCTION IF EXISTS store_credit_redeem_on_sale(UUID, UUID, NUMERIC, UUID);
--   DROP TRIGGER IF EXISTS trg_store_credit_block_mutation ON store_credit_events;
--   DROP FUNCTION IF EXISTS store_credit_events_block_mutation();
--   DROP TRIGGER IF EXISTS trg_store_credit_apply_balance ON store_credit_events;
--   DROP FUNCTION IF EXISTS store_credit_events_apply_balance();
--   DROP TABLE IF EXISTS store_credit_events;
--   ALTER TABLE settings
--     DROP COLUMN IF EXISTS store_credit_expiry_days,
--     DROP COLUMN IF EXISTS store_credit_enabled;
--   ALTER TABLE customers DROP COLUMN IF EXISTS store_credit_balance;
-- ============================================================================

-- ── customers column ──────────────────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS store_credit_balance NUMERIC(18,4) NOT NULL DEFAULT 0
    CHECK (store_credit_balance >= 0);

COMMENT ON COLUMN customers.store_credit_balance IS
  'Materialized store-credit balance in shop currency. Maintained by trg_store_credit_apply_balance on store_credit_events INSERT — never written directly by app code. CHECK (>= 0) is the safety net: a debit that would overdraw rolls back the whole parent transaction.';

-- ── settings columns ──────────────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS store_credit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS store_credit_expiry_days INTEGER
    CHECK (store_credit_expiry_days IS NULL OR store_credit_expiry_days > 0);

COMMENT ON COLUMN settings.store_credit_enabled IS
  'Master gate for store credit. When FALSE the redeem RPC refuses, the customer panel hides, and store credit does not appear as a refund or buy-payout method. Off by default — a shop opts in.';
COMMENT ON COLUMN settings.store_credit_expiry_days IS
  'Informational only in v1: how long the shop tells customers their credit lasts. NOTHING expires credit automatically — unclaimed store credit is a liability and several states treat it as unclaimed property. Wire an expiry job only after checking the statute for the jurisdiction.';

-- ── store_credit_events table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_credit_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN (
    'issue_return',    -- refund issued as store credit instead of cash/card
    'issue_buy',       -- buy-outright paid out as store credit
    'issue_manual',    -- staff issued credit (goodwill, gift card, etc.)
    'redeem_pos',      -- spent as a tender on a sale
    'redeem_undo',     -- a redemption reversed (undo on an open sale, or void)
    'clawback',        -- credit issued in error / reversed with its source
    'adjust_manual'    -- owner/manager correction, either direction
  )),
  amount_delta     NUMERIC(18,4) NOT NULL,
  -- What produced this row: 'sale' | 'return' | 'buy' | 'store_credit_event'.
  source_kind      TEXT,
  source_id        UUID,
  -- Soft pointer to the sale_payments row a redeem_pos created. Deliberately
  -- NOT a foreign key: an ON DELETE action would issue an UPDATE/DELETE that
  -- trg_store_credit_block_mutation rejects, and this ledger outliving a
  -- payment row is the correct behaviour for an append-only book.
  sale_payment_id  UUID,
  reason           TEXT,
  performed_by     UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT store_credit_events_sign_matches_kind CHECK (
    (kind IN ('issue_return','issue_buy','issue_manual','redeem_undo')
       AND amount_delta > 0)
    OR (kind IN ('redeem_pos','clawback') AND amount_delta < 0)
    OR (kind = 'adjust_manual' AND amount_delta <> 0)
  )
);

COMMENT ON TABLE store_credit_events IS
  'Append-only store-credit ledger. UPDATE and DELETE are blocked by trg_store_credit_block_mutation — correct a mistake with a compensating row, never by editing. customers.store_credit_balance is the materialized sum, maintained by trg_store_credit_apply_balance.';
COMMENT ON COLUMN store_credit_events.amount_delta IS
  'Signed amount in shop currency, numeric(18,4). Positive issues credit, negative spends or claws it back. The sign is constrained per kind so an app-side sign slip cannot corrupt a balance.';

CREATE INDEX IF NOT EXISTS idx_store_credit_events_customer_created
  ON store_credit_events (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_credit_events_tenant_created
  ON store_credit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_credit_events_source
  ON store_credit_events (source_kind, source_id)
  WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS store_credit_events_idempotency
  ON store_credit_events (customer_id, source_kind, source_id, kind)
  WHERE source_kind IS NOT NULL
    AND source_id IS NOT NULL
    AND kind IN ('issue_return', 'issue_buy', 'clawback', 'redeem_undo');

-- ── Trigger: balance maintenance (AFTER INSERT) ───────────────────────────
CREATE OR REPLACE FUNCTION store_credit_events_apply_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE customers
     SET store_credit_balance = ROUND(store_credit_balance + NEW.amount_delta, 4),
         updated_at = NOW()
   WHERE id = NEW.customer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_credit_apply_balance ON store_credit_events;
CREATE TRIGGER trg_store_credit_apply_balance
  AFTER INSERT ON store_credit_events
  FOR EACH ROW EXECUTE FUNCTION store_credit_events_apply_balance();

-- ── Trigger: append-only enforcement (BEFORE UPDATE OR DELETE) ────────────
CREATE OR REPLACE FUNCTION store_credit_events_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'store_credit_events is append-only — write a compensating event instead'
    USING ERRCODE = '23000';
END;
$$;

DROP TRIGGER IF EXISTS trg_store_credit_block_mutation ON store_credit_events;
CREATE TRIGGER trg_store_credit_block_mutation
  BEFORE UPDATE OR DELETE ON store_credit_events
  FOR EACH ROW EXECUTE FUNCTION store_credit_events_block_mutation();

-- ── RPC: redeem store credit as a tender on an open sale ──────────────────
--
-- The whole point of the RPC. Three writes that MUST be atomic:
--   1. the ledger debit          (customer actually loses the credit)
--   2. the sale_payments row     (the sale actually gets paid)
--   3. the sales.paid_total bump (the balance due actually goes down)
-- Doing these as three PostgREST calls from a server action leaves three
-- ways to half-apply a tender. Every error is raised with a stable token
-- as the message so the action layer can translate it (Rule 6).
CREATE OR REPLACE FUNCTION store_credit_redeem_on_sale(
  p_tenant_id    UUID,
  p_sale_id      UUID,
  p_amount       NUMERIC,
  p_performed_by UUID DEFAULT NULL
)
-- Output columns carry an o_ prefix: plpgsql would otherwise resolve
-- `sale_payment_id` inside the function body to the OUT parameter rather
-- than the store_credit_events column of the same name.
RETURNS TABLE (o_sale_payment_id UUID, o_event_id UUID, o_new_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale      sales%ROWTYPE;
  v_enabled   BOOLEAN;
  v_amount    NUMERIC(18,4);
  v_remaining NUMERIC(18,4);
  v_balance   NUMERIC(18,4);
  v_pay_id    UUID;
  v_event_id  UUID;
BEGIN
  v_amount := ROUND(p_amount, 4);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'store_credit_invalid_amount' USING ERRCODE = '22023';
  END IF;

  SELECT store_credit_enabled INTO v_enabled
    FROM settings WHERE tenant_id = p_tenant_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'store_credit_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_credit_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.status <> 'open' THEN
    RAISE EXCEPTION 'store_credit_sale_not_open' USING ERRCODE = 'P0001';
  END IF;
  IF v_sale.customer_id IS NULL THEN
    RAISE EXCEPTION 'store_credit_no_customer' USING ERRCODE = 'P0001';
  END IF;

  v_remaining := ROUND(v_sale.total - v_sale.paid_total, 4);
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'store_credit_exceeds_balance_due'
      USING ERRCODE = 'P0001',
            DETAIL = format('requested %s, remaining %s', v_amount, v_remaining);
  END IF;

  -- Lock the customer so two registers cannot spend the same credit.
  SELECT store_credit_balance INTO v_balance
    FROM customers
   WHERE id = v_sale.customer_id AND tenant_id = p_tenant_id
     FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'store_credit_customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'store_credit_insufficient_balance'
      USING ERRCODE = 'P0001',
            DETAIL = format('requested %s, available %s', v_amount, v_balance);
  END IF;

  INSERT INTO sale_payments (
    sale_id, tenant_id, amount, payment_method, card_present_status, performed_by
  ) VALUES (
    p_sale_id, p_tenant_id, v_amount, 'store_credit', 'not_used', p_performed_by
  )
  RETURNING id INTO v_pay_id;

  INSERT INTO store_credit_events (
    tenant_id, customer_id, kind, amount_delta,
    source_kind, source_id, sale_payment_id, performed_by
  ) VALUES (
    p_tenant_id, v_sale.customer_id, 'redeem_pos', -v_amount,
    'sale', p_sale_id, v_pay_id, p_performed_by
  )
  RETURNING id INTO v_event_id;

  UPDATE sales
     SET paid_total = ROUND(paid_total + v_amount, 4),
         updated_by = COALESCE(p_performed_by, updated_by)
   WHERE id = p_sale_id;

  SELECT c.store_credit_balance INTO v_balance
    FROM customers c WHERE c.id = v_sale.customer_id;

  RETURN QUERY SELECT v_pay_id, v_event_id, v_balance;
END;
$$;

-- ── RPC: undo one redemption while the sale is still open ─────────────────
CREATE OR REPLACE FUNCTION store_credit_undo_sale_redemption(
  p_tenant_id    UUID,
  p_event_id     UUID,
  p_performed_by UUID DEFAULT NULL
)
RETURNS TABLE (o_event_id UUID, o_new_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ev        store_credit_events%ROWTYPE;
  v_sale      sales%ROWTYPE;
  v_amount    NUMERIC(18,4);
  v_new_event UUID;
  v_balance   NUMERIC(18,4);
BEGIN
  SELECT * INTO v_ev
    FROM store_credit_events
   WHERE id = p_event_id AND tenant_id = p_tenant_id;
  IF NOT FOUND OR v_ev.kind <> 'redeem_pos' OR v_ev.source_kind <> 'sale' THEN
    RAISE EXCEPTION 'store_credit_event_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = v_ev.source_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_credit_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.status <> 'open' THEN
    -- A locked sale's tenders are reversed by voiding it, not by undoing a
    -- single line — otherwise paid_total would drift away from is_locked.
    RAISE EXCEPTION 'store_credit_sale_not_open' USING ERRCODE = 'P0001';
  END IF;

  v_amount := ABS(v_ev.amount_delta);

  -- Compensating row first: the idempotency index makes a double-undo fail
  -- here, BEFORE paid_total is touched.
  INSERT INTO store_credit_events (
    tenant_id, customer_id, kind, amount_delta,
    source_kind, source_id, sale_payment_id, reason, performed_by
  ) VALUES (
    p_tenant_id, v_ev.customer_id, 'redeem_undo', v_amount,
    'store_credit_event', v_ev.id, v_ev.sale_payment_id, 'undo_redemption',
    p_performed_by
  )
  RETURNING id INTO v_new_event;

  IF v_ev.sale_payment_id IS NOT NULL THEN
    UPDATE sale_payments
       SET deleted_at = NOW()
     WHERE id = v_ev.sale_payment_id
       AND tenant_id = p_tenant_id
       AND deleted_at IS NULL;
  END IF;

  UPDATE sales
     SET paid_total = GREATEST(ROUND(paid_total - v_amount, 4), 0),
         updated_by = COALESCE(p_performed_by, updated_by)
   WHERE id = v_sale.id;

  SELECT c.store_credit_balance INTO v_balance
    FROM customers c WHERE c.id = v_ev.customer_id;

  RETURN QUERY SELECT v_new_event, v_balance;
END;
$$;

-- ── RPC: restore every redemption on a sale (void path) ───────────────────
--
-- Mirrors the card-refund path in voidSaleAction: the payment rows STAY on
-- the voided sale as history, and the money goes back to the customer —
-- here by putting the credit back on their balance.
CREATE OR REPLACE FUNCTION store_credit_restore_for_sale(
  p_tenant_id    UUID,
  p_sale_id      UUID,
  p_performed_by UUID DEFAULT NULL
)
RETURNS TABLE (o_restored_count INTEGER, o_restored_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   RECORD;
  v_count INTEGER := 0;
  v_total NUMERIC(18,4) := 0;
BEGIN
  FOR v_row IN
    SELECT e.*
      FROM store_credit_events e
     WHERE e.tenant_id = p_tenant_id
       AND e.kind = 'redeem_pos'
       AND e.source_kind = 'sale'
       AND e.source_id = p_sale_id
       AND NOT EXISTS (
         SELECT 1 FROM store_credit_events u
          WHERE u.kind = 'redeem_undo'
            AND u.source_kind = 'store_credit_event'
            AND u.source_id = e.id
       )
     ORDER BY e.created_at
  LOOP
    INSERT INTO store_credit_events (
      tenant_id, customer_id, kind, amount_delta,
      source_kind, source_id, sale_payment_id, reason, performed_by
    ) VALUES (
      p_tenant_id, v_row.customer_id, 'redeem_undo', ABS(v_row.amount_delta),
      'store_credit_event', v_row.id, v_row.sale_payment_id, 'sale_voided',
      p_performed_by
    );
    v_count := v_count + 1;
    v_total := ROUND(v_total + ABS(v_row.amount_delta), 4);
  END LOOP;

  RETURN QUERY SELECT v_count, v_total;
END;
$$;

REVOKE ALL ON FUNCTION store_credit_redeem_on_sale(UUID, UUID, NUMERIC, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION store_credit_undo_sale_redemption(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION store_credit_restore_for_sale(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION store_credit_redeem_on_sale(UUID, UUID, NUMERIC, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION store_credit_undo_sale_redemption(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION store_credit_restore_for_sale(UUID, UUID, UUID)
  TO service_role;

-- ── RLS on store_credit_events ────────────────────────────────────────────
ALTER TABLE store_credit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_credit_events_staff_select ON store_credit_events;
CREATE POLICY store_credit_events_staff_select ON store_credit_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Defense-in-depth: app writes go through the service_role RPCs above, but
-- if a future path uses a user-scoped client, staff still cannot forge
-- attribution to another user.
DROP POLICY IF EXISTS store_credit_events_staff_insert ON store_credit_events;
CREATE POLICY store_credit_events_staff_insert ON store_credit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
    AND (performed_by IS NULL OR performed_by = auth.uid())
  );

DROP POLICY IF EXISTS store_credit_events_portal_select ON store_credit_events;
CREATE POLICY store_credit_events_portal_select ON store_credit_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = store_credit_events.customer_id
         AND c.auth_user_id = auth.uid()
    )
  );

-- Tell PostgREST to pick up the new table + columns + policies.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0053-store-credit.sql
-- ============================================================================
