-- ───────────────────────────────────────────────────────────────────────────
-- 0055 — consignment reversals never exceed what still stands
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0054 has already run.
--           Append-only — never edit prior migrations.
--
-- The bug (found by the 0054 smoke test, before any shop had data)
--
--   consignment_reverse_on_void() reversed the FULL accrual for every line
--   on the sale, and consignment_reverse_on_return() reversed its pro-rata
--   share of the FULL accrual, neither of them looking at reversals that
--   had already landed. Two ways that double-counts against a consignor:
--
--     1. A line is fully returned (reversal −160), then the sale is voided
--        (another reversal −160). The consignor's balance goes to −160 on
--        an item that only ever accrued +160. voidSaleAction is reachable
--        on a 'partial_returned' / 'fully_returned' sale, so this is a
--        path a clerk can walk, not a theoretical one.
--     2. Repeated partial returns whose quantities sum past the quantity
--        sold. The app caps each return at the remaining quantity, but the
--        ledger should not depend on the app getting that right.
--
--   Money owed to someone who is not in the room is exactly where the
--   database has to be the authority.
--
-- The fix
--
--   Both triggers now compute the UNREVERSED REMAINDER of the accrual —
--   the signed sum of every row already written for that sale_item — and
--   clamp to it:
--
--     return: reverse MIN(pro-rata share, remainder)
--     void:   reverse exactly the remainder
--     either: skip entirely when the remainder is already zero
--
--   Gross, commission and payable all scale by the same clamped fraction,
--   so the three columns stay consistent and still sum back to the
--   accrual.
--
--   Bodies only — the triggers from 0054 keep pointing at these functions.
--
-- Rollback
--
--   Re-run the two CREATE OR REPLACE FUNCTION blocks from
--   patches/0054-consignment.sql.
-- ============================================================================

-- How much of an accrual has NOT been reversed yet, as a fraction of the
-- original. 1.0 = untouched, 0.0 = fully reversed. Never negative.
CREATE OR REPLACE FUNCTION consignment_unreversed_fraction(
  p_sale_item_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_accrual_gross   NUMERIC(18,4);
  v_accrual_payable NUMERIC(18,4);
  v_net_gross       NUMERIC(18,4);
  v_net_payable     NUMERIC(18,4);
BEGIN
  SELECT gross_amount, payable_amount
    INTO v_accrual_gross, v_accrual_payable
    FROM consignment_payables
   WHERE sale_item_id = p_sale_item_id AND kind = 'accrual';
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(gross_amount), 0), COALESCE(SUM(payable_amount), 0)
    INTO v_net_gross, v_net_payable
    FROM consignment_payables
   WHERE sale_item_id = p_sale_item_id;

  -- Normally the gross tells us what is left. A line that sold for zero
  -- (a giveaway that still owes the consignor nothing) has no gross to
  -- divide by, so fall back to the payable; if both are zero there is
  -- nothing to reverse either way.
  IF v_accrual_gross <> 0 THEN
    RETURN GREATEST(LEAST(v_net_gross / v_accrual_gross, 1), 0);
  ELSIF v_accrual_payable <> 0 THEN
    RETURN GREATEST(LEAST(v_net_payable / v_accrual_payable, 1), 0);
  ELSE
    RETURN 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION consignment_unreversed_fraction(UUID)
  FROM PUBLIC, anon, authenticated;

-- ── Return: reverse the pro-rata share, capped at what still stands ───────
CREATE OR REPLACE FUNCTION consignment_reverse_on_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_accrual   consignment_payables%ROWTYPE;
  v_sold_qty  NUMERIC(8,3);
  v_fraction  NUMERIC;
  v_remaining NUMERIC;
  v_gross     NUMERIC(18,4);
  v_comm      NUMERIC(18,4);
BEGIN
  SELECT * INTO v_accrual
    FROM consignment_payables
   WHERE sale_item_id = NEW.sale_item_id AND kind = 'accrual';
  IF NOT FOUND THEN
    -- Not a consigned line, or the sale never completed. Nothing owed,
    -- nothing to take back.
    RETURN NEW;
  END IF;

  SELECT quantity INTO v_sold_qty FROM sale_items WHERE id = NEW.sale_item_id;
  IF v_sold_qty IS NULL OR v_sold_qty <= 0 THEN
    RETURN NEW;
  END IF;

  v_remaining := consignment_unreversed_fraction(NEW.sale_item_id);
  IF v_remaining <= 0 THEN
    -- Already fully reversed (an earlier return, or a void). Taking more
    -- back would put the consignor in debt over an item they were only
    -- ever credited once for.
    RETURN NEW;
  END IF;

  v_fraction := LEAST(NEW.quantity / v_sold_qty, v_remaining);
  v_gross    := ROUND(v_accrual.gross_amount * v_fraction, 4);
  v_comm     := ROUND(v_accrual.commission_amount * v_fraction, 4);

  INSERT INTO consignment_payables (
    tenant_id, consignor_id, inventory_item_id, sale_id, sale_item_id,
    return_item_id, kind, reason, gross_amount, commission_pct,
    commission_amount, payable_amount
  ) VALUES (
    v_accrual.tenant_id, v_accrual.consignor_id, v_accrual.inventory_item_id,
    v_accrual.sale_id, v_accrual.sale_item_id, NEW.id, 'reversal',
    'item_returned', -v_gross, v_accrual.commission_pct, -v_comm,
    -ROUND(v_gross - v_comm, 4)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── Void: reverse exactly what is left, line by line ─────────────────────
CREATE OR REPLACE FUNCTION consignment_reverse_on_void()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_accrual   consignment_payables%ROWTYPE;
  v_remaining NUMERIC;
  v_gross     NUMERIC(18,4);
  v_comm      NUMERIC(18,4);
BEGIN
  FOR v_accrual IN
    SELECT * FROM consignment_payables
     WHERE sale_id = NEW.id AND kind = 'accrual'
  LOOP
    v_remaining := consignment_unreversed_fraction(v_accrual.sale_item_id);
    CONTINUE WHEN v_remaining <= 0;

    v_gross := ROUND(v_accrual.gross_amount * v_remaining, 4);
    v_comm  := ROUND(v_accrual.commission_amount * v_remaining, 4);

    INSERT INTO consignment_payables (
      tenant_id, consignor_id, inventory_item_id, sale_id, sale_item_id,
      return_item_id, kind, reason, gross_amount, commission_pct,
      commission_amount, payable_amount
    ) VALUES (
      v_accrual.tenant_id, v_accrual.consignor_id, v_accrual.inventory_item_id,
      v_accrual.sale_id, v_accrual.sale_item_id, NULL, 'reversal',
      'sale_voided', -v_gross, v_accrual.commission_pct, -v_comm,
      -ROUND(v_gross - v_comm, 4)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0055-consignment-reversal-remainder.sql
-- ============================================================================
