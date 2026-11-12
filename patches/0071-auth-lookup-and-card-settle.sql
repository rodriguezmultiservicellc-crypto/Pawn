-- ───────────────────────────────────────────────────────────────────────────
-- 0071 — service-role helpers behind two security fixes (review 2026-11-11)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna. Additive. No table, column, RLS
-- policy or grant on any table is touched — two functions only, both
-- callable by service_role and nobody else.
--
-- 1. auth_user_id_by_email(text) → uuid
--
--    Exact, case-insensitive lookup of an auth account by email.
--
--    Why: the team-invite and portal-invite flows have to know whether an
--    email ALREADY belongs to an account, because a sign-in link must never
--    be minted and handed to staff for an account that already exists (that
--    was an account-takeover path: invite the owner's or the platform
--    operator's email, receive a working login link for it). The old code
--    found the user by listing the first 50 auth users, which is neither
--    exact nor complete. auth.users is not reachable through PostgREST, so
--    the lookup lives here.
--
-- 2. sale_card_payment_succeeded(uuid) → (applied, reason, sale_id,
--    tenant_id, amount, paid_total)
--
--    Marks a PENDING card tender on a sale as succeeded and adds it to
--    sales.paid_total, under a row lock, exactly once.
--
--    Why: a card tender used to be added to paid_total the moment the
--    PaymentIntent was created — before any card was presented — so a sale
--    could be completed with nothing collected. A card tender now counts
--    only when it settles: this function is the single place that happens,
--    called by the Stripe webhook (payment_intent.succeeded) and by the
--    manager "confirm card approved" action. Row lock + status check make a
--    webhook retry or a double click a no-op instead of a double count.
--
--    If the sale is no longer open when the card settles (voided or
--    completed meanwhile), the tender is still marked succeeded — the card
--    WAS charged — but paid_total is left alone and reason says why, so the
--    caller can flag it for a refund.
--
-- Rollback
--   DROP FUNCTION IF EXISTS sale_card_payment_succeeded(UUID);
--   DROP FUNCTION IF EXISTS auth_user_id_by_email(TEXT);
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(btrim(p_email))
  ORDER BY u.created_at
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth_user_id_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_user_id_by_email(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION auth_user_id_by_email(TEXT) TO service_role;

COMMENT ON FUNCTION auth_user_id_by_email(TEXT) IS
  'service_role only. Exact case-insensitive auth.users lookup by email. '
  'Used to refuse minting a sign-in link for an account that already exists.';

CREATE OR REPLACE FUNCTION sale_card_payment_succeeded(p_payment_id UUID)
RETURNS TABLE (
  applied     BOOLEAN,
  reason      TEXT,
  sale_id     UUID,
  tenant_id   UUID,
  amount      NUMERIC(18,4),
  paid_total  NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay   sale_payments%ROWTYPE;
  v_sale  sales%ROWTYPE;
BEGIN
  SELECT * INTO v_pay
  FROM sale_payments sp
  WHERE sp.id = p_payment_id AND sp.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;
  IF v_pay.payment_method <> 'card' THEN
    RAISE EXCEPTION 'wrong_method';
  END IF;

  SELECT * INTO v_sale
  FROM sales s
  WHERE s.id = v_pay.sale_id AND s.tenant_id = v_pay.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found';
  END IF;

  -- Already settled (or failed / refunded): nothing to do. Idempotent.
  IF v_pay.card_present_status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, 'not_pending'::TEXT, v_sale.id, v_sale.tenant_id,
                        v_pay.amount, v_sale.paid_total;
    RETURN;
  END IF;

  UPDATE sale_payments sp
  SET card_present_status = 'succeeded'
  WHERE sp.id = v_pay.id;

  -- The card was charged, but the sale moved on without it. Record the
  -- tender as succeeded and leave the total alone; the caller flags it.
  IF v_sale.status <> 'open' THEN
    RETURN QUERY SELECT FALSE, 'sale_not_open'::TEXT, v_sale.id, v_sale.tenant_id,
                        v_pay.amount, v_sale.paid_total;
    RETURN;
  END IF;

  UPDATE sales s
  SET paid_total = s.paid_total + v_pay.amount
  WHERE s.id = v_sale.id
  RETURNING s.paid_total INTO v_sale.paid_total;

  RETURN QUERY SELECT TRUE, 'applied'::TEXT, v_sale.id, v_sale.tenant_id,
                      v_pay.amount, v_sale.paid_total;
END;
$$;

REVOKE ALL ON FUNCTION sale_card_payment_succeeded(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION sale_card_payment_succeeded(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION sale_card_payment_succeeded(UUID) TO service_role;

COMMENT ON FUNCTION sale_card_payment_succeeded(UUID) IS
  'service_role only. Settle a pending card tender: mark it succeeded and '
  'add it to sales.paid_total under a row lock, once. The only place a card '
  'tender is counted as paid.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0071-auth-lookup-and-card-settle.sql
-- ============================================================================
