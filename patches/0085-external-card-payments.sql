-- ───────────────────────────────────────────────────────────────────────────
-- 0085 — External card payments (card run on the shop's own machine)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0084.
--
-- Until now a 'card' tender could only be a Stripe card-present
-- PaymentIntent (sale_add_payment refuses card without one), and it counts
-- only when Stripe or a manager settles it (0071). A shop that runs cards on
-- its own terminal (Clover, Square, a bank machine…) had no way to record
-- that. Same pattern as Luna Azul's "External card".
--
--   sale_payments.card_entry      'reader' | 'external' | NULL (non-card,
--                                  and card rows written before 0085)
--   sale_payments.card_last4      4 digits, from the slip
--   sale_payments.card_brand      visa | mastercard | amex | discover | other
--   sale_payments.card_auth_code  approval code from the slip (optional)
--
--   sale_add_external_card_payment(...)  records the tender as SETTLED at
--   once (card_present_status 'succeeded', counted in paid_total): the
--   machine already approved it before staff typed it in. Same row lock,
--   cents rounding and balance check (pending cards included) as
--   sale_add_payment. SECURITY DEFINER, service_role only — the app guards
--   the role first.
--
-- sale_add_payment is NOT changed. Every UPDATE carries a WHERE (PostgREST
-- loads pg_safeupdate — see 0084).
-- RLS: no policy added or changed.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS card_entry text,
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS card_auth_code text;

ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_card_entry_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_card_entry_check
  CHECK (card_entry IS NULL OR card_entry IN ('reader', 'external'));

ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_card_last4_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_card_last4_check
  CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');

ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_card_brand_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_card_brand_check
  CHECK (card_brand IS NULL OR card_brand IN ('visa', 'mastercard', 'amex', 'discover', 'other'));

ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_card_auth_code_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_card_auth_code_check
  CHECK (card_auth_code IS NULL OR card_auth_code ~ '^[A-Za-z0-9]{1,12}$');

-- Card details only on card rows; an external card always has its last 4.
ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_card_details_check;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_card_details_check
  CHECK (
    (payment_method = 'card' OR (card_entry IS NULL AND card_last4 IS NULL
                                 AND card_brand IS NULL AND card_auth_code IS NULL))
    AND (card_entry IS DISTINCT FROM 'external' OR card_last4 IS NOT NULL)
  );

COMMENT ON COLUMN public.sale_payments.card_entry IS
  'How a card tender was taken: reader (Stripe card-present) or external (shop''s own machine, 0085). NULL = not a card, or a card row written before 0085.';

CREATE OR REPLACE FUNCTION public.sale_add_external_card_payment(
  p_tenant_id  uuid,
  p_sale_id    uuid,
  p_user_id    uuid,
  p_amount     numeric,
  p_last4      text,
  p_brand      text,
  p_auth_code  text DEFAULT NULL,
  p_notes      text DEFAULT NULL
)
RETURNS TABLE(o_payment_id uuid, o_paid_total numeric, o_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale     sales%ROWTYPE;
  v_amount   NUMERIC(18,4) := ROUND(COALESCE(p_amount, 0), 2);
  v_last4    TEXT := btrim(COALESCE(p_last4, ''));
  v_brand    TEXT := lower(btrim(COALESCE(p_brand, '')));
  v_auth     TEXT := NULLIF(upper(btrim(COALESCE(p_auth_code, ''))), '');
  v_pending  NUMERIC(18,4);
  v_open     NUMERIC(18,4);
  v_id       UUID;
BEGIN
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'bad_amount' USING ERRCODE = 'P0001';
  END IF;
  IF v_last4 !~ '^[0-9]{4}$'
     OR v_brand NOT IN ('visa', 'mastercard', 'amex', 'discover', 'other')
     OR (v_auth IS NOT NULL AND v_auth !~ '^[A-Z0-9]{1,12}$') THEN
    RAISE EXCEPTION 'bad_card_details' USING ERRCODE = 'P0001';
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

  -- A pending reader charge still reserves its amount (same rule as 0076).
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
    card_entry, card_last4, card_brand, card_auth_code, notes, performed_by
  ) VALUES (
    p_sale_id, p_tenant_id, v_amount, 'card', 'succeeded',
    'external', v_last4, v_brand, v_auth,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user_id
  )
  RETURNING id INTO v_id;

  UPDATE sales SET paid_total = paid_total + v_amount, updated_by = p_user_id
   WHERE id = p_sale_id
   RETURNING paid_total INTO v_sale.paid_total;

  RETURN QUERY SELECT v_id, v_sale.paid_total,
                      GREATEST(0, ROUND(v_sale.total, 2) - v_sale.paid_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.sale_add_external_card_payment(uuid, uuid, uuid, numeric, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_add_external_card_payment(uuid, uuid, uuid, numeric, text, text, text, text)
  TO service_role;
