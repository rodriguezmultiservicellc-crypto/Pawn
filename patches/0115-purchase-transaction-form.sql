-- 0115 — A purchase is written on the pawnbroker transaction form.
--
-- Fla. Stat. § 539.001(8)(a) (2026, read 2026-11-25): "At the time the
-- pawnbroker enters into any pawn or purchase transaction, the pawnbroker
-- shall complete a pawnbroker transaction form for such transaction,
-- including an indication of whether the transaction is a pawn or a
-- purchase, and the pledgor or seller shall sign such completed form."
-- (2)(j): the form is "the instrument on which a pawnbroker records pawns and
-- purchases". (8)(b)6 lists what only a pawn prints (amount financed, maturity,
-- default date, charge, APR, the forfeiture statement); (8)(b)7 is a
-- purchase's amount paid; (8)(b)8 (the ownership and false-verification
-- statements) is both.
--
-- Until now a buy printed a store receipt (/buy/new). Eddy, 2026-11-25: with
-- a Florida pawn license a buy is processed like a pawn and marked as a
-- purchase. So:
--
--   1. jurisdictions.purchase_on_form — this state's purchases go on the
--      transaction form (rule 18: the state decides, not code). FL = TRUE.
--      Those shops buy from the New pawn ticket screen in Purchase mode;
--      /buy/new sends them there, and a buy prints the form, "Purchase"
--      checked.
--   2. ticket_notices[].pawn_only — a statement that belongs only on a pawn
--      (FL: the forfeiture statement, (8)(b)6.g, and the shop's no-refund
--      line from 0102). A purchase prints the others.
--   3. A buy's ticket number. Every buy_outright compliance row written
--      without a reference_number gets 'BT-' + 6 digits from the tenant
--      counter 'buy_ticket' (it used to carry the first item's SKU; rows
--      already written keep theirs — compliance_log is write-once). It is
--      the form's control number and the police upload's <ticket_number>.
--      Eddy's Jewelers continues xPawn's buy count (21667 is the highest buy
--      in the LeadsOnline files through 2026-11-17), as PT- continued the
--      pawn count; re-check it against xPawn before cutover.
--
-- No RLS policy is touched. Running this again changes nothing.

-- ── 1. The state's rule ─────────────────────────────────────────────────────
ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS purchase_on_form BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN jurisdictions.purchase_on_form IS
  'Purchases are written on the pawnbroker transaction form, marked as a purchase (FL § 539.001(8)(a)).';

UPDATE jurisdictions
   SET purchase_on_form = TRUE,
       verified_on = DATE '2026-11-25',
       verified_source = 'Fla. Stat. § 539.001 (2026), subsections (2)(j), (2)(q), (8)(a)-(b), (9)(a), (9)(c), (10), (11)(a)-(c), (11)(e), (12)(c)'
 WHERE code = 'US-FL'
   AND purchase_on_form IS DISTINCT FROM TRUE;

-- ── 2. Pawn-only statements ─────────────────────────────────────────────────
UPDATE jurisdictions j
   SET ticket_notices = (
         SELECT jsonb_agg(
                  CASE
                    WHEN n->>'en' LIKE 'Any personal property pledged to a pawnbroker%'
                      OR n->>'en' LIKE 'If you pay off your loan early%'
                    THEN n || jsonb_build_object('pawn_only', true)
                    ELSE n
                  END
                  ORDER BY ord)
           FROM jsonb_array_elements(j.ticket_notices) WITH ORDINALITY AS e(n, ord)
       )
 WHERE j.code = 'US-FL'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(j.ticket_notices) AS n
      WHERE (n->>'en' LIKE 'Any personal property pledged to a pawnbroker%'
          OR n->>'en' LIKE 'If you pay off your loan early%')
        AND NOT (n ? 'pawn_only')
   );

-- ── 3. A buy's ticket number ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compliance_log_buy_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type = 'buy_outright'
     AND (NEW.reference_number IS NULL OR btrim(NEW.reference_number) = '') THEN
    NEW.reference_number :=
      'BT-' || LPAD(next_tenant_counter(NEW.tenant_id, 'buy_ticket')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compliance_log_buy_ticket_number ON compliance_log;
CREATE TRIGGER trg_compliance_log_buy_ticket_number
BEFORE INSERT ON compliance_log
FOR EACH ROW EXECUTE FUNCTION compliance_log_buy_ticket_number();

-- Eddy's Jewelers (its LeadsOnline store number): continue xPawn's buys.
INSERT INTO tenant_counters (tenant_id, counter_name, last_value)
SELECT t.id, 'buy_ticket', 21667
  FROM tenants t
 WHERE t.agency_store_id = '103110000228401'
ON CONFLICT (tenant_id, counter_name) DO UPDATE
  SET last_value = GREATEST(tenant_counters.last_value, EXCLUDED.last_value),
      updated_at = NOW();

-- Finding a buy by its number.
CREATE INDEX IF NOT EXISTS idx_compliance_log_reference
  ON compliance_log (tenant_id, reference_number)
  WHERE reference_number IS NOT NULL;
