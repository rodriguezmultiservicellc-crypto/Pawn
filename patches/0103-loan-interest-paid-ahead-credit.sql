-- 0103 — Unused interest paid ahead is given back when the loan is paid off.
--
-- Fla. Stat. § 539.001(11)(c), last sentence: "Any unused pawn service charge
-- paid in advance by the pledgor shall be refunded by the pawnbroker."
--
-- A customer who pays interest ahead (moves the due date further than the
-- time that has passed) and then redeems early has paid for time they did
-- not use. The payoff now takes that off (lib/pawn/math.interestPaidAhead),
-- and the event that CLOSES the loan books it as a reversal:
--
--   principal_paid = the principal still owed
--   interest_paid  = minus the unused interest        (negative)
--   amount         = principal_paid + interest_paid   (the cash taken)
--
-- A compensating entry, never an edit of the earlier payment — so every sum
-- of interest_paid (interest income on every report) counts only what was
-- earned, without any report having to know about it.
--
-- 1. loan_events_split_signs allowed no negative. It now allows negative
--    interest ONLY against principal paid in the same event, and never more
--    than that principal: an event can give interest back only while taking
--    at least as much toward the loan. Nothing else changes: principal and
--    fees are still never negative.
--    Re-adding the CHECK reads every row once; it rewrites none and fires no
--    trigger (imported events untouched — rule 22).
--
-- 2. loan_apply_online_payment clamped the interest at 0. It now accepts the
--    same reversal for an online payment that pays the loan off.
--
-- No RLS policy is touched. Grants on the function are unchanged (same
-- signature, CREATE OR REPLACE).

ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS loan_events_split_signs;
ALTER TABLE loan_events ADD CONSTRAINT loan_events_split_signs CHECK (
  principal_paid >= 0
  AND fees_paid >= 0
  AND (interest_paid >= 0 OR principal_paid + interest_paid >= 0)
);

COMMENT ON COLUMN loan_events.interest_paid IS
  'Interest taken by this event. Negative ONLY on the event that pays the loan off, when the customer had paid interest ahead and did not use it (§ 539.001(11)(c)): the unused part is given back against the principal paid in the same event.';

-- ── loan_apply_online_payment ─────────────────────────────────────────────
-- Same as patches/0076, except p_interest may be negative (see above).
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
  v_interest  NUMERIC(18,4) := ROUND(COALESCE(p_interest, 0), 2);
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
  -- Interest is given back only against principal paid by this payment.
  IF v_interest < 0 AND v_interest + v_principal < 0 THEN
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

  -- Interest comes back only on the payment that pays the loan off.
  IF v_interest < 0 AND NOT v_redeem THEN
    RAISE EXCEPTION 'bad_amount' USING ERRCODE = 'P0001';
  END IF;

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
