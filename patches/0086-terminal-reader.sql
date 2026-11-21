-- ───────────────────────────────────────────────────────────────────────────
-- 0086 — Stripe Terminal reader at the counter (server-driven)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0085.
--
-- Pawn runs one open register per shop, so the shop pairs ONE reader. The
-- app drives it from the server (Stripe's server-driven Terminal API:
-- process_payment_intent on the reader) and polls the PaymentIntent — the
-- same pattern as Luna Azul, on the shop's Connect account.
--
--   settings.stripe_terminal_location_id   Stripe Terminal Location on the
--   settings.stripe_terminal_reader_id     connected account, and the paired
--   settings.stripe_terminal_reader_label  reader (owner writes — existing
--                                          settings RLS, unchanged)
--
--   sale_add_payment            unchanged except: a card row now records
--                               card_entry = 'reader' (0085 column).
--   sale_card_payment_failed    a pending reader charge that was declined or
--                               cancelled → 'failed', so it stops holding the
--                               balance. Only touches a PENDING card row.
--   sale_card_payment_set_details  brand + last 4 Stripe reported, written on
--                               a reader row after it settles.
--
-- New functions: SECURITY DEFINER, service_role only. Every UPDATE carries a
-- WHERE (0084). RLS: no policy added or changed.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS stripe_terminal_location_id text,
  ADD COLUMN IF NOT EXISTS stripe_terminal_reader_id text,
  ADD COLUMN IF NOT EXISTS stripe_terminal_reader_label text;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_stripe_terminal_reader_check;
ALTER TABLE public.settings ADD CONSTRAINT settings_stripe_terminal_reader_check
  CHECK (
    (stripe_terminal_reader_id IS NULL OR stripe_terminal_reader_id ~ '^tmr_[A-Za-z0-9]+$')
    AND (stripe_terminal_location_id IS NULL OR stripe_terminal_location_id ~ '^tml_[A-Za-z0-9]+$')
    AND (stripe_terminal_reader_label IS NULL OR char_length(stripe_terminal_reader_label) <= 60)
  );

CREATE OR REPLACE FUNCTION public.sale_add_payment(p_tenant_id uuid, p_sale_id uuid, p_user_id uuid, p_amount numeric, p_method payment_method, p_stripe_pi text DEFAULT NULL::text, p_reader_id text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(o_payment_id uuid, o_counted boolean, o_paid_total numeric, o_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    stripe_payment_intent_id, reader_id, notes, performed_by, card_entry
  ) VALUES (
    p_sale_id, p_tenant_id, v_amount, p_method,
    CASE WHEN p_method = 'card' THEN 'pending'::card_present_status
         ELSE 'not_used'::card_present_status END,
    p_stripe_pi, p_reader_id, NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user_id,
    CASE WHEN p_method = 'card' THEN 'reader' END  -- 0086
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
$function$;

CREATE OR REPLACE FUNCTION public.sale_card_payment_failed(p_payment_id uuid, p_reason text DEFAULT NULL)
RETURNS TABLE(o_failed boolean, o_sale_id uuid, o_tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale uuid;
  v_tenant uuid;
BEGIN
  UPDATE sale_payments
     SET card_present_status = 'failed',
         notes = left(concat_ws(' · ', NULLIF(notes, ''), NULLIF(btrim(COALESCE(p_reason, '')), '')), 500)
   WHERE id = p_payment_id
     AND payment_method = 'card'
     AND card_present_status = 'pending'
     AND deleted_at IS NULL
  RETURNING sale_id, tenant_id INTO v_sale, v_tenant;
  RETURN QUERY SELECT v_sale IS NOT NULL, v_sale, v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sale_card_payment_set_details(p_payment_id uuid, p_last4 text, p_brand text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_last4 text := NULLIF(btrim(COALESCE(p_last4, '')), '');
  v_brand text := lower(btrim(COALESCE(p_brand, '')));
BEGIN
  IF v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$' THEN v_last4 := NULL; END IF;
  IF v_brand NOT IN ('visa', 'mastercard', 'amex', 'discover') THEN
    v_brand := CASE WHEN v_brand = '' THEN NULL ELSE 'other' END;
  END IF;
  UPDATE sale_payments
     SET card_last4 = COALESCE(v_last4, card_last4),
         card_brand = COALESCE(v_brand, card_brand)
   WHERE id = p_payment_id
     AND payment_method = 'card'
     AND card_entry = 'reader'
     AND deleted_at IS NULL;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.sale_card_payment_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_card_payment_failed(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.sale_card_payment_set_details(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_card_payment_set_details(uuid, text, text) TO service_role;
