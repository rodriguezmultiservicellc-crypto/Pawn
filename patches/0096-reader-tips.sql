-- ───────────────────────────────────────────────────────────────────────────
-- 0096 — Tips on the card reader, credited to the employee
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0095.
--
-- Until now the reader was always told to skip its tip screen. A shop can
-- now turn tips on (Settings → Card reader). When it is on the reader asks
-- the customer for a tip; Stripe adds it to the card charge and reports it
-- separately from the sale amount.
--
--   settings.reader_tips_enabled            the switch. Off by default: no
--                                           shop's customers see a tip screen
--                                           they did not ask for.
--   settings.reader_tip_percentages         the choices the reader offers
--                                           (1 to 3 whole percents).
--   settings.stripe_terminal_tip_config_id  the Stripe Terminal Configuration
--                                           the app keeps those choices in.
--
--   sale_payments.tip_amount   the tip on that card payment. It is NOT part
--                              of `amount`: `amount` is what went toward the
--                              sale, the card was charged amount + tip_amount.
--                              sales.paid_total and the sale's balance never
--                              include a tip.
--   sale_payments.tip_user_id  the employee the tip belongs to: the person
--                              who ran that card payment (performed_by).
--
--   sale_card_payment_set_tip  the ONLY writer of those two columns. Called
--                              when Stripe reports the charge approved (the
--                              counter's status check and the webhook — both
--                              may call it; it records a tip once).
--
-- New function: SECURITY DEFINER, service_role only. Every UPDATE carries a
-- WHERE (0084). RLS: no policy added or changed — tips are columns of
-- sale_payments, which staff already read under its existing policy.
--
-- Rollback
--   DROP FUNCTION IF EXISTS sale_card_payment_set_tip(UUID, NUMERIC);
--   ALTER TABLE sale_payments DROP COLUMN IF EXISTS tip_user_id, DROP COLUMN IF EXISTS tip_amount;
--   ALTER TABLE settings DROP COLUMN IF EXISTS stripe_terminal_tip_config_id,
--     DROP COLUMN IF EXISTS reader_tip_percentages, DROP COLUMN IF EXISTS reader_tips_enabled;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS reader_tips_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reader_tip_percentages INTEGER[] NOT NULL DEFAULT '{15,20,25}',
  ADD COLUMN IF NOT EXISTS stripe_terminal_tip_config_id TEXT;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_reader_tips_check;
ALTER TABLE public.settings ADD CONSTRAINT settings_reader_tips_check
  CHECK (
    cardinality(reader_tip_percentages) BETWEEN 1 AND 3
    AND 1 <= ALL (reader_tip_percentages)
    AND 100 >= ALL (reader_tip_percentages)
    AND (stripe_terminal_tip_config_id IS NULL OR stripe_terminal_tip_config_id ~ '^tmc_[A-Za-z0-9]+$')
  );

COMMENT ON COLUMN settings.reader_tips_enabled IS
  'Ask for a tip on the card reader. Off = every reader charge is sent with skip_tipping.';
COMMENT ON COLUMN settings.reader_tip_percentages IS
  'Tip choices the reader offers, whole percents, in the order shown (1 to 3).';

ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  ADD COLUMN IF NOT EXISTS tip_user_id UUID REFERENCES auth.users(id);

COMMENT ON COLUMN sale_payments.tip_amount IS
  'Tip the customer added on the card reader. Not part of amount: the card was charged amount + tip_amount. Written only by sale_card_payment_set_tip.';
COMMENT ON COLUMN sale_payments.tip_user_id IS
  'Employee the tip belongs to (who ran the card payment). NULL when there is no tip.';

-- Tips by employee and date (the tips report).
CREATE INDEX IF NOT EXISTS idx_sale_payments_tips
  ON sale_payments (tenant_id, occurred_at) WHERE tip_amount > 0 AND deleted_at IS NULL;

-- ── sale_card_payment_set_tip ─────────────────────────────────────────────
-- Records the tip Stripe reported on an approved reader charge and credits it
-- to the employee who ran the payment. A tip is written once: a second call
-- (the webhook after the counter, or the other way round) changes nothing.
CREATE OR REPLACE FUNCTION public.sale_card_payment_set_tip(p_payment_id uuid, p_tip numeric)
RETURNS TABLE(o_recorded boolean, o_tip numeric, o_user_id uuid, o_sale_id uuid, o_tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tip  NUMERIC(18,4) := ROUND(GREATEST(COALESCE(p_tip, 0), 0), 2);
  v_row  sale_payments%ROWTYPE;
  v_done BOOLEAN := FALSE;
BEGIN
  IF v_tip > 0 THEN
    UPDATE sale_payments
       SET tip_amount = v_tip,
           tip_user_id = performed_by
     WHERE id = p_payment_id
       AND payment_method = 'card'
       AND card_entry = 'reader'
       AND card_present_status <> 'failed'
       AND tip_amount = 0
       AND deleted_at IS NULL;
    v_done := FOUND;
  END IF;

  SELECT * INTO v_row FROM sale_payments WHERE id = p_payment_id AND deleted_at IS NULL;
  RETURN QUERY SELECT v_done, v_row.tip_amount, v_row.tip_user_id, v_row.sale_id, v_row.tenant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sale_card_payment_set_tip(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_card_payment_set_tip(uuid, numeric) TO service_role;

NOTIFY pgrst, 'reload schema';
