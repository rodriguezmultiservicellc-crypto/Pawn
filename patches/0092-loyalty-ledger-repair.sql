-- ───────────────────────────────────────────────────────────────────────────
-- 0092 — Loyalty ledger repair (live DB had drifted from patches/0028)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0091. Append-only.
--
-- Found 2026-11-21 while building the customer merge (0091). On the live DB:
--
--   1. No loyalty functions or triggers at all. loyalty_events_apply_balance,
--      loyalty_events_block_mutation and customers_referral_same_tenant
--      (0028) were missing, so an earned point would be logged but never
--      reach customers.loyalty_points_balance, and the "append-only" log
--      could be edited or deleted.
--   2. The kind CHECK lacked 'redeem_undo' and 'earn_clawback', which
--      lib/loyalty/events.ts inserts (undo a redemption, claw back points on
--      a voided / returned sale) — those inserts would fail.
--   3. loyalty_events_idempotency had lost its kind filter, so a second
--      redeem_pos on the same sale, or a repeat undo, hit a unique
--      violation that 0028 deliberately allowed.
--
-- State at repair time: 0 loyalty events, every balance 0, no tenant has
-- loyalty_enabled, 0 cross-tenant referrals — nothing to backfill.
--
-- No RLS change. loyalty_events stays RLS-on with NO policies: every read
-- and write goes through the service-role client after a guard (staff
-- customer page, POS sale page/actions, portal loyalty page, lib/loyalty).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_loyalty_events_apply_balance ON loyalty_events;
--   DROP TRIGGER IF EXISTS trg_loyalty_events_block_mutation ON loyalty_events;
--   DROP TRIGGER IF EXISTS trg_customers_referral_same_tenant ON customers;
--   (the CHECK / index changes only widen what 0028 intended — keep them)
-- ============================================================================

-- ── 1. Kinds: 0028's set + 0091's merge pair ──────────────────────────────
ALTER TABLE loyalty_events DROP CONSTRAINT IF EXISTS loyalty_events_kind_check;
ALTER TABLE loyalty_events ADD CONSTRAINT loyalty_events_kind_check
  CHECK (kind = ANY (ARRAY['earn_sale','earn_loan_interest','earn_referral_bonus',
                           'redeem_pos','redeem_undo','earn_clawback','adjust_manual',
                           'merge_in','merge_out']));

-- ── 2. Idempotency only on the auto-credit kinds (0028 definition) ────────
DROP INDEX IF EXISTS loyalty_events_idempotency;
CREATE UNIQUE INDEX loyalty_events_idempotency
  ON loyalty_events (customer_id, source_kind, source_id, kind)
  WHERE source_kind IS NOT NULL
    AND source_id IS NOT NULL
    AND kind IN ('earn_sale', 'earn_loan_interest', 'earn_referral_bonus', 'earn_clawback');

-- ── 3. Balance maintenance (AFTER INSERT) ─────────────────────────────────
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

-- ── 4. Append-only (BEFORE UPDATE OR DELETE) ──────────────────────────────
-- Cascades from a tenant / customer hard delete run at trigger depth > 1
-- and pass (same rule as ofac_screenings_guard); everything else is blocked.
CREATE OR REPLACE FUNCTION loyalty_events_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'loyalty_events is append-only — write a compensating event instead'
    USING ERRCODE = '23000';
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_events_block_mutation ON loyalty_events;
CREATE TRIGGER trg_loyalty_events_block_mutation
  BEFORE UPDATE OR DELETE ON loyalty_events
  FOR EACH ROW EXECUTE FUNCTION loyalty_events_block_mutation();

-- ── 5. Referral must stay inside the shop ─────────────────────────────────
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

-- ── 6. Balances = ledger (all 0 today; makes the invariant explicit) ──────
UPDATE customers c
   SET loyalty_points_balance = s.total
  FROM (SELECT customer_id, SUM(points_delta)::int AS total
          FROM loyalty_events GROUP BY customer_id) s
 WHERE s.customer_id = c.id
   AND c.loyalty_points_balance IS DISTINCT FROM s.total;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0092-loyalty-ledger-repair.sql
-- ============================================================================
