-- ───────────────────────────────────────────────────────────────────────────
-- 0076 — Sale money functions (PLAN-2026-11-13 Phase 0; REVIEW-2026-11-11
--        findings 11, 12, 13, 16)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0075.
--           Append-only — never edit prior migrations.
--
-- Every way money or stock moves on a sale now goes through ONE function,
-- under row locks, called by the staff actions AND the Stripe webhook:
--
--   sale_create        sale + lines + stock flip, totals computed here in
--                      cents. Locks each inventory row: two registers (or
--                      the website later) cannot sell the same piece.
--   sale_add_payment   one tender on an open retail sale. Locks the sale;
--                      paid_total is added to in place, never read-then-
--                      written by the app. Refuses more than is owed.
--   sale_complete      closes a fully paid sale (retail or layaway).
--                      Idempotent: completing twice is a no-op.
--   layaway_create     sale_create + the layaway row + the down payment.
--   layaway_add_payment
--                      a payment on an active layaway: layaway row, mirror
--                      sale_payments row, both paid totals, and — when the
--                      balance reaches zero — sale_complete(), so a layaway
--                      paid off online completes its sale, flips the item to
--                      sold and accrues the consignor (finding 12).
--   loan_apply_online_payment
--                      the webhook's loan payment. Refuses a loan that is no
--                      longer open (finding 11), refuses if the loan's
--                      principal changed since the split was computed (the
--                      webhook retries), and never books a surplus as fees.
--
-- Amounts are cents (finding 16): every computed money value is ROUND(…, 2);
-- comparisons against older 4-decimal totals round those too.
--
-- Webhook idempotency: loan_events.stripe_session_id and
-- layaway_payments.stripe_session_id, unique when set. A redelivered event
-- returns 'duplicate' instead of posting twice.
--
-- RLS: no new tables, no policy changes. Functions are SECURITY DEFINER and
-- EXECUTE is granted to service_role only; the app guards the user first
-- (requireRoleInTenant) and passes the guarded tenant + user.
--
-- Rollback
--   DROP FUNCTION IF EXISTS loan_apply_online_payment(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS layaway_add_payment(UUID, UUID, UUID, NUMERIC, payment_method, card_present_status, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC);
--   DROP FUNCTION IF EXISTS sale_complete(UUID, UUID, UUID);
--   DROP FUNCTION IF EXISTS sale_add_payment(UUID, UUID, UUID, NUMERIC, payment_method, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB);
--   DROP INDEX IF EXISTS uq_layaway_payments_stripe_session;
--   DROP INDEX IF EXISTS uq_loan_events_stripe_session;
--   ALTER TABLE layaway_payments DROP COLUMN IF EXISTS stripe_session_id;
--   ALTER TABLE loan_events DROP COLUMN IF EXISTS stripe_session_id;
-- ───────────────────────────────────────────────────────────────────────────

-- ── Idempotency columns ───────────────────────────────────────────────────
ALTER TABLE loan_events      ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE layaway_payments ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_events_stripe_session
  ON loan_events (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_layaway_payments_stripe_session
  ON layaway_payments (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- ── sale_create ───────────────────────────────────────────────────────────
-- p_items: [{ "inventory_item_id": uuid|null, "description": text,
--             "quantity": num, "unit_price": num, "line_discount": num }]
CREATE OR REPLACE FUNCTION sale_create(
  p_tenant_id           UUID,
  p_user_id             UUID,
  p_register_session_id UUID,
  p_sale_kind           sale_kind,
  p_customer_id         UUID,
  p_tax_rate            NUMERIC,
  p_discount            NUMERIC,
  p_notes               TEXT,
  p_items               JSONB
)
RETURNS TABLE (o_sale_id UUID, o_sale_number TEXT, o_total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale_id   UUID;
  v_number    TEXT;
  v_ids       UUID[];
  v_locked    INTEGER;
  v_subtotal  NUMERIC(18,4);
  v_discount  NUMERIC(18,4);
  v_taxable   NUMERIC(18,4);
  v_tax       NUMERIC(18,4);
  v_total     NUMERIC(18,4);
  v_rate      NUMERIC := COALESCE(p_tax_rate, 0);
BEGIN
  IF p_sale_kind NOT IN ('retail', 'layaway') THEN
    RAISE EXCEPTION 'sale_bad_kind' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'cart_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF v_rate < 0 OR v_rate > 1 THEN
    RAISE EXCEPTION 'bad_tax_rate' USING ERRCODE = 'P0001';
  END IF;
  IF p_sale_kind = 'layaway' AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM register_sessions
   WHERE id = p_register_session_id AND tenant_id = p_tenant_id
     AND status = 'open' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_open_session' USING ERRCODE = 'P0001';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers
     WHERE id = p_customer_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Lines, validated and priced in cents.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_create_lines (
    pos INTEGER, inventory_item_id UUID, description TEXT,
    quantity NUMERIC, unit_price NUMERIC, line_discount NUMERIC, line_total NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.sale_create_lines;

  INSERT INTO pg_temp.sale_create_lines
  SELECT (e.ord - 1)::int,
         NULLIF(e.item ->> 'inventory_item_id', '')::uuid,
         btrim(COALESCE(e.item ->> 'description', '')),
         COALESCE((e.item ->> 'quantity')::numeric, 1),
         ROUND(COALESCE((e.item ->> 'unit_price')::numeric, 0), 2),
         ROUND(COALESCE((e.item ->> 'line_discount')::numeric, 0), 2),
         NULL
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(item, ord);

  IF EXISTS (SELECT 1 FROM pg_temp.sale_create_lines
              WHERE description = '' OR quantity <= 0 OR unit_price < 0 OR line_discount < 0) THEN
    RAISE EXCEPTION 'bad_line' USING ERRCODE = 'P0001';
  END IF;
  -- A piece is one of a kind: one line, quantity one.
  IF EXISTS (SELECT 1 FROM pg_temp.sale_create_lines
              WHERE inventory_item_id IS NOT NULL AND quantity <> 1) THEN
    RAISE EXCEPTION 'bad_line' USING ERRCODE = 'P0001';
  END IF;

  UPDATE pg_temp.sale_create_lines
     SET line_total = GREATEST(0, ROUND(quantity * unit_price - line_discount, 2));

  -- Lock every linked piece, in id order (no deadlock between two registers).
  SELECT array_agg(DISTINCT inventory_item_id ORDER BY inventory_item_id)
    INTO v_ids
    FROM pg_temp.sale_create_lines WHERE inventory_item_id IS NOT NULL;

  IF v_ids IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM pg_temp.sale_create_lines WHERE inventory_item_id IS NOT NULL)
       <> array_length(v_ids, 1) THEN
      RAISE EXCEPTION 'duplicate_item' USING ERRCODE = 'P0001';
    END IF;
    SELECT COUNT(*) INTO v_locked FROM (
      SELECT 1 FROM inventory_items i
       WHERE i.id = ANY (v_ids) AND i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
       ORDER BY i.id
         FOR UPDATE
    ) l;
    IF v_locked <> array_length(v_ids, 1) OR EXISTS (
      SELECT 1 FROM inventory_items i
       WHERE i.id = ANY (v_ids) AND i.status <> 'available'
    ) THEN
      RAISE EXCEPTION 'inventory_out_of_stock' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal FROM pg_temp.sale_create_lines;
  v_discount := ROUND(GREATEST(0, COALESCE(p_discount, 0)), 2);
  v_taxable  := GREATEST(0, v_subtotal - v_discount);
  v_tax      := ROUND(v_taxable * v_rate, 2);
  v_total    := v_taxable + v_tax;

  INSERT INTO sales (
    tenant_id, register_session_id, sale_kind, status, customer_id,
    subtotal, tax_amount, tax_rate, discount_amount, total,
    paid_total, returned_total, notes, is_locked, created_by, updated_by
  ) VALUES (
    p_tenant_id, p_register_session_id, p_sale_kind, 'open', p_customer_id,
    v_subtotal, v_tax, v_rate, v_discount, v_total,
    0, 0, NULLIF(btrim(COALESCE(p_notes, '')), ''), FALSE, p_user_id, p_user_id
  )
  RETURNING id, sale_number INTO v_sale_id, v_number;

  -- The consignment floor trigger checks each line here.
  INSERT INTO sale_items (
    sale_id, tenant_id, inventory_item_id, description, quantity,
    unit_price, line_discount, line_total, position, returned_qty
  )
  SELECT v_sale_id, p_tenant_id, l.inventory_item_id, l.description, l.quantity,
         l.unit_price, l.line_discount, l.line_total, l.pos, 0
    FROM pg_temp.sale_create_lines l
   ORDER BY l.pos;

  IF v_ids IS NOT NULL THEN
    UPDATE inventory_items
       SET status = CASE WHEN p_sale_kind = 'layaway' THEN 'held'::inventory_status
                         ELSE 'sold'::inventory_status END,
           updated_by = p_user_id
     WHERE id = ANY (v_ids) AND tenant_id = p_tenant_id;
  END IF;

  RETURN QUERY SELECT v_sale_id, v_number, v_total;
END;
$$;

-- ── sale_add_payment ──────────────────────────────────────────────────────
-- A card tender is a PaymentIntent waiting on the reader: recorded as
-- 'pending' and NOT counted until sale_card_payment_succeeded() settles it
-- (0071). It still reserves its amount, so cash cannot be taken on top of a
-- card that is about to clear.
CREATE OR REPLACE FUNCTION sale_add_payment(
  p_tenant_id  UUID,
  p_sale_id    UUID,
  p_user_id    UUID,
  p_amount     NUMERIC,
  p_method     payment_method,
  p_stripe_pi  TEXT DEFAULT NULL,
  p_reader_id  TEXT DEFAULT NULL,
  p_notes      TEXT DEFAULT NULL
)
RETURNS TABLE (o_payment_id UUID, o_counted BOOLEAN, o_paid_total NUMERIC, o_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale     sales%ROWTYPE;
  v_amount   NUMERIC(18,4) := ROUND(COALESCE(p_amount, 0), 2);
  v_pending  NUMERIC(18,4);
  v_open     NUMERIC(18,4);
  v_counted  BOOLEAN := p_method <> 'card';
  v_id       UUID;
BEGIN
  IF p_method = 'store_credit' THEN
    -- Spending credit has its own ledger function (0053).
    RAISE EXCEPTION 'use_store_credit_redeem' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'bad_amount' USING ERRCODE = 'P0001';
  END IF;
  IF p_method = 'card' AND p_stripe_pi IS NULL THEN
    RAISE EXCEPTION 'card_needs_payment_intent' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sale FROM sales
   WHERE id = p_sale_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.status <> 'open' THEN
    RAISE EXCEPTION 'sale_not_open' USING ERRCODE = 'P0001';
  END IF;
  IF v_sale.sale_kind = 'layaway' THEN
    RAISE EXCEPTION 'use_layaway_payment' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_pending
    FROM sale_payments
   WHERE sale_id = p_sale_id AND deleted_at IS NULL
     AND payment_method = 'card' AND card_present_status = 'pending';

  v_open := ROUND(v_sale.total, 2) - v_sale.paid_total - v_pending;
  IF v_amount > v_open THEN
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = 'P0001',
      DETAIL = format('amount %s, open %s', v_amount, v_open);
  END IF;

  INSERT INTO sale_payments (
    sale_id, tenant_id, amount, payment_method, card_present_status,
    stripe_payment_intent_id, reader_id, notes, performed_by
  ) VALUES (
    p_sale_id, p_tenant_id, v_amount, p_method,
    CASE WHEN p_method = 'card' THEN 'pending'::card_present_status
         ELSE 'not_used'::card_present_status END,
    p_stripe_pi, p_reader_id, NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user_id
  )
  RETURNING id INTO v_id;

  IF v_counted THEN
    UPDATE sales SET paid_total = paid_total + v_amount, updated_by = p_user_id
     WHERE id = p_sale_id
     RETURNING paid_total INTO v_sale.paid_total;
  END IF;

  RETURN QUERY SELECT v_id, v_counted, v_sale.paid_total,
                      GREATEST(0, ROUND(v_sale.total, 2) - v_sale.paid_total);
END;
$$;

-- ── sale_complete ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sale_complete(
  p_tenant_id UUID,
  p_sale_id   UUID,
  p_user_id   UUID
)
RETURNS TABLE (o_completed BOOLEAN, o_reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM sales
   WHERE id = p_sale_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.status = 'completed' THEN
    RETURN QUERY SELECT FALSE, 'already_completed'::text;
    RETURN;
  END IF;
  IF v_sale.status <> 'open' THEN
    RAISE EXCEPTION 'sale_not_open' USING ERRCODE = 'P0001';
  END IF;
  -- paid_total holds settled money only; a pending card is not in it.
  IF ROUND(v_sale.total, 2) - v_sale.paid_total > 0 THEN
    RAISE EXCEPTION 'balance_remaining' USING ERRCODE = 'P0001';
  END IF;

  -- Consignment accrual and market-data triggers fire on this update.
  UPDATE sales
     SET status = 'completed', is_locked = TRUE, completed_at = NOW(), updated_by = p_user_id
   WHERE id = p_sale_id;

  IF v_sale.sale_kind = 'layaway' THEN
    UPDATE inventory_items i
       SET status = 'sold', updated_by = p_user_id
      FROM sale_items si
     WHERE si.sale_id = p_sale_id AND si.deleted_at IS NULL
       AND si.inventory_item_id = i.id
       AND i.tenant_id = p_tenant_id AND i.status = 'held';

    UPDATE layaways
       SET status = 'completed', completed_at = COALESCE(completed_at, NOW()),
           balance_remaining = 0, updated_by = p_user_id
     WHERE sale_id = p_sale_id AND tenant_id = p_tenant_id AND status = 'active';
  END IF;

  RETURN QUERY SELECT TRUE, 'completed'::text;
END;
$$;

-- ── layaway_add_payment ───────────────────────────────────────────────────
-- Staff: p_stripe_session NULL; anything off (not active, too much) raises.
-- Webhook: p_stripe_session set; the card was already charged, so instead of
-- raising it returns a reason the caller flags for a refund:
--   duplicate           this session was already posted
--   layaway_not_active  completed / cancelled meanwhile — nothing posted
--   overpaid            posted the balance; o_excess needs refunding
CREATE OR REPLACE FUNCTION layaway_add_payment(
  p_tenant_id      UUID,
  p_layaway_id     UUID,
  p_user_id        UUID,
  p_amount         NUMERIC,
  p_method         payment_method,
  p_card_status    card_present_status DEFAULT 'not_used',
  p_stripe_pi      TEXT DEFAULT NULL,
  p_stripe_session TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
)
RETURNS TABLE (
  o_payment_id UUID, o_paid_total NUMERIC, o_balance NUMERIC,
  o_completed BOOLEAN, o_reason TEXT, o_excess NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lay     layaways%ROWTYPE;
  v_amount  NUMERIC(18,4) := ROUND(COALESCE(p_amount, 0), 2);
  v_balance NUMERIC(18,4);
  v_excess  NUMERIC(18,4) := 0;
  v_id      UUID;
  v_online  BOOLEAN := p_stripe_session IS NOT NULL;
  v_done    BOOLEAN := FALSE;
BEGIN
  IF p_method = 'store_credit' THEN
    RAISE EXCEPTION 'use_store_credit_redeem' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'bad_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_lay FROM layaways
   WHERE id = p_layaway_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'layaway_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_online AND EXISTS (SELECT 1 FROM layaway_payments WHERE stripe_session_id = p_stripe_session) THEN
    RETURN QUERY SELECT NULL::uuid, v_lay.paid_total, v_lay.balance_remaining, FALSE, 'duplicate'::text, 0::numeric;
    RETURN;
  END IF;

  IF v_lay.status <> 'active' THEN
    IF v_online THEN
      RETURN QUERY SELECT NULL::uuid, v_lay.paid_total, v_lay.balance_remaining, FALSE,
                          'layaway_not_active'::text, v_amount;
      RETURN;
    END IF;
    RAISE EXCEPTION 'layaway_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the parent sale too: its paid_total moves in the same transaction.
  PERFORM 1 FROM sales WHERE id = v_lay.sale_id AND tenant_id = p_tenant_id FOR UPDATE;

  v_balance := GREATEST(0, ROUND(v_lay.total_due, 2) - v_lay.paid_total);
  IF v_amount > v_balance THEN
    IF NOT v_online THEN
      RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = 'P0001';
    END IF;
    v_excess := v_amount - v_balance;
    v_amount := v_balance;
  END IF;

  IF v_amount > 0 THEN
    INSERT INTO layaway_payments (
      layaway_id, tenant_id, amount, payment_method, card_present_status,
      stripe_payment_intent_id, stripe_session_id, notes, performed_by
    ) VALUES (
      p_layaway_id, p_tenant_id, v_amount, p_method, p_card_status,
      p_stripe_pi, p_stripe_session, NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user_id
    )
    RETURNING id INTO v_id;

    INSERT INTO sale_payments (
      sale_id, tenant_id, amount, payment_method, card_present_status,
      stripe_payment_intent_id, notes, performed_by
    ) VALUES (
      v_lay.sale_id, p_tenant_id, v_amount, p_method, p_card_status,
      p_stripe_pi, COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), 'layaway_payment'), p_user_id
    );

    UPDATE layaways
       SET paid_total = paid_total + v_amount,
           balance_remaining = GREATEST(0, ROUND(total_due, 2) - (paid_total + v_amount)),
           updated_by = p_user_id
     WHERE id = p_layaway_id
     RETURNING * INTO v_lay;

    UPDATE sales SET paid_total = paid_total + v_amount, updated_by = p_user_id
     WHERE id = v_lay.sale_id;
  END IF;

  IF v_lay.balance_remaining <= 0 THEN
    PERFORM sale_complete(p_tenant_id, v_lay.sale_id, p_user_id);
    v_done := TRUE;
  END IF;

  RETURN QUERY SELECT v_id, v_lay.paid_total,
                      CASE WHEN v_done THEN 0::numeric ELSE v_lay.balance_remaining END,
                      v_done,
                      CASE WHEN v_excess > 0 THEN 'overpaid' ELSE 'applied' END,
                      v_excess;
END;
$$;

-- ── layaway_create ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION layaway_create(
  p_tenant_id           UUID,
  p_user_id             UUID,
  p_register_session_id UUID,
  p_customer_id         UUID,
  p_tax_rate            NUMERIC,
  p_discount            NUMERIC,
  p_notes               TEXT,
  p_items               JSONB,
  p_schedule_kind       TEXT,
  p_down_payment        NUMERIC,
  p_down_method         payment_method,
  p_first_payment_due   DATE,
  p_final_due_date      DATE,
  p_cancellation_fee    NUMERIC
)
RETURNS TABLE (o_sale_id UUID, o_layaway_id UUID, o_layaway_number TEXT, o_total NUMERIC, o_completed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale_id UUID;
  v_total   NUMERIC(18,4);
  v_lay_id  UUID;
  v_number  TEXT;
  v_down    NUMERIC(18,4) := ROUND(COALESCE(p_down_payment, 0), 2);
  v_done    BOOLEAN := FALSE;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.o_sale_id, c.o_total INTO v_sale_id, v_total
    FROM sale_create(p_tenant_id, p_user_id, p_register_session_id, 'layaway',
                     p_customer_id, p_tax_rate, p_discount, p_notes, p_items) c;

  IF v_down > v_total THEN
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO layaways (
    tenant_id, sale_id, customer_id, status, total_due, paid_total, balance_remaining,
    schedule_kind, down_payment, first_payment_due, final_due_date,
    cancellation_fee_pct, notes, created_by, updated_by
  ) VALUES (
    p_tenant_id, v_sale_id, p_customer_id, 'active', v_total, 0, v_total,
    COALESCE(p_schedule_kind, 'weekly'), v_down, p_first_payment_due, p_final_due_date,
    COALESCE(p_cancellation_fee, 0), NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user_id, p_user_id
  )
  RETURNING id, layaway_number INTO v_lay_id, v_number;

  IF v_down > 0 THEN
    SELECT p.o_completed INTO v_done
      FROM layaway_add_payment(p_tenant_id, v_lay_id, p_user_id, v_down, p_down_method,
                               'not_used', NULL, NULL, 'down_payment') p;
  END IF;

  RETURN QUERY SELECT v_sale_id, v_lay_id, v_number, v_total, COALESCE(v_done, FALSE);
END;
$$;

-- ── loan_apply_online_payment ─────────────────────────────────────────────
-- The split (interest first, then principal) is computed by the app from the
-- jurisdiction rules; this function posts it only if the loan is still open
-- and its principal has not moved since (p_principal_paid_before). If it has
-- moved, it raises 'loan_changed' and the webhook retries with a fresh split.
-- Reasons: applied | duplicate | loan_closed (nothing posted; refund all)
-- o_excess = charged minus applied, to refund. Never booked as fees.
CREATE OR REPLACE FUNCTION loan_apply_online_payment(
  p_tenant_id             UUID,
  p_loan_id               UUID,
  p_amount                NUMERIC,
  p_interest              NUMERIC,
  p_principal             NUMERIC,
  p_principal_paid_before NUMERIC,
  p_stripe_session        TEXT,
  p_stripe_pi             TEXT
)
RETURNS TABLE (o_event_id UUID, o_reason TEXT, o_redeemed BOOLEAN, o_excess NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loan      loans%ROWTYPE;
  v_amount    NUMERIC(18,4) := ROUND(COALESCE(p_amount, 0), 2);
  v_interest  NUMERIC(18,4) := ROUND(GREATEST(0, COALESCE(p_interest, 0)), 2);
  v_principal NUMERIC(18,4) := ROUND(GREATEST(0, COALESCE(p_principal, 0)), 2);
  v_paid_now  NUMERIC(18,4);
  v_redeem    BOOLEAN;
  v_id        UUID;
BEGIN
  IF p_stripe_session IS NULL THEN
    RAISE EXCEPTION 'session_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount <= 0 OR v_interest + v_principal > v_amount THEN
    RAISE EXCEPTION 'bad_amount' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM loan_events WHERE stripe_session_id = p_stripe_session) THEN
    RETURN QUERY SELECT NULL::uuid, 'duplicate'::text, FALSE, 0::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_loan FROM loans
   WHERE id = p_loan_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'loan_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_loan.status NOT IN ('active', 'extended', 'partial_paid') THEN
    RETURN QUERY SELECT NULL::uuid, 'loan_closed'::text, FALSE, v_amount;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(principal_paid), 0) INTO v_paid_now
    FROM loan_events WHERE loan_id = p_loan_id;
  IF v_paid_now <> COALESCE(p_principal_paid_before, 0) THEN
    RAISE EXCEPTION 'loan_changed' USING ERRCODE = 'P0001';
  END IF;

  v_redeem := v_loan.principal - (v_paid_now + v_principal) <= 0;

  INSERT INTO loan_events (
    loan_id, tenant_id, event_type, amount, principal_paid, interest_paid, fees_paid,
    payment_method, notes, stripe_session_id
  ) VALUES (
    p_loan_id, p_tenant_id,
    CASE WHEN v_redeem THEN 'redemption'::loan_event_type ELSE 'payment'::loan_event_type END,
    v_interest + v_principal, v_principal, v_interest, 0,
    'card',
    format('Online payment via Stripe (session %s%s)', p_stripe_session,
           CASE WHEN p_stripe_pi IS NOT NULL THEN ', payment ' || p_stripe_pi ELSE '' END),
    p_stripe_session
  )
  RETURNING id INTO v_id;

  IF v_redeem THEN
    UPDATE loans SET status = 'redeemed' WHERE id = p_loan_id;
  ELSIF v_loan.status = 'active' THEN
    UPDATE loans SET status = 'partial_paid' WHERE id = p_loan_id;
  END IF;

  RETURN QUERY SELECT v_id, 'applied'::text, v_redeem, v_amount - v_interest - v_principal;
END;
$$;

-- ── Grants: service_role only ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sale_add_payment(UUID, UUID, UUID, NUMERIC, payment_method, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sale_complete(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION layaway_add_payment(UUID, UUID, UUID, NUMERIC, payment_method, card_present_status, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION loan_apply_online_payment(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION sale_create(UUID, UUID, UUID, sale_kind, UUID, NUMERIC, NUMERIC, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION sale_add_payment(UUID, UUID, UUID, NUMERIC, payment_method, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sale_complete(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION layaway_add_payment(UUID, UUID, UUID, NUMERIC, payment_method, card_present_status, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION layaway_create(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, NUMERIC, payment_method, DATE, DATE, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION loan_apply_online_payment(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
