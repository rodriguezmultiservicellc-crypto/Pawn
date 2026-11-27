-- 0125 — The pawn's redeem-by date on its police record (Eddy, 2026-11-27).
--
-- LeadsOnline's Ticket has redeemByDate (API) / <redeem_date> (upload file).
-- It is the maturity date printed on the customer's ticket
-- (loans.due_date at intake, FL 539.001(8)(b)6.b) — frozen here when the
-- ticket is written, so a later extension never changes what was reported
-- (rule 15: the police data is a snapshot, never derived at report time).
-- Written by createLoanAction; NULL for buys and for pawns written before
-- this patch (the record is write-once — they are not backfilled).
--
-- The write-once guard (patches/0001) listed its protected columns by name;
-- it now also protects redeem_by, and reference_number + clerk
-- (patches/0111), which were only ever written at insert — the one UPDATE
-- of reference_number was 0111's own backfill.
--
-- No policy is added or changed.

ALTER TABLE public.compliance_log
  ADD COLUMN IF NOT EXISTS redeem_by DATE;

COMMENT ON COLUMN public.compliance_log.redeem_by IS
  'Pawn: the maturity date on the ticket when it was written (loans.due_date at intake). NULL for buys and pre-0125 pawns.';

CREATE OR REPLACE FUNCTION prevent_compliance_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compliance_log is write-once. Rows cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id         IS DISTINCT FROM OLD.tenant_id         OR
       NEW.source_table      IS DISTINCT FROM OLD.source_table      OR
       NEW.source_id         IS DISTINCT FROM OLD.source_id         OR
       NEW.event_type        IS DISTINCT FROM OLD.event_type        OR
       NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot OR
       NEW.items_snapshot    IS DISTINCT FROM OLD.items_snapshot    OR
       NEW.amount            IS DISTINCT FROM OLD.amount            OR
       NEW.occurred_at       IS DISTINCT FROM OLD.occurred_at       OR
       NEW.reference_number  IS DISTINCT FROM OLD.reference_number  OR
       NEW.clerk             IS DISTINCT FROM OLD.clerk             OR
       NEW.redeem_by         IS DISTINCT FROM OLD.redeem_by THEN
      RAISE EXCEPTION 'compliance_log snapshot fields are immutable. Only export bookkeeping fields may be updated.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
