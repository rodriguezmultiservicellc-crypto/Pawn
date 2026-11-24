-- 0108 — A voided pawn ticket reaches the police report.
--
-- Until now voiding a ticket wrote nothing to compliance_log (rule 15), so
-- the daily LeadsOnline export kept reporting a pawn that never stood: a
-- test ticket, a ticket written to the wrong customer.
--
-- 1. Voiding a ticket writes a 'pawn_void' row the moment it happens — a
--    trigger on loans, so no code path can void without it. The row copies
--    the intake row's customer, items and amount (what was, or would have
--    been, reported). Only a ticket with a pawn_intake row gets one: an
--    imported ticket (rule 22) was reported by the old system, and its void
--    is not ours to report.
--
-- 2. The export decides per ticket (src/lib/compliance/police-report/
--    void-plan.ts):
--      - voided BEFORE it was reported  -> neither row goes in the file;
--        both are stamped export_outcome = 'withheld_void'.
--      - voided AFTER it was reported   -> the void row is stamped
--        'void_notice' and listed on its batch (voided_after_report) and on
--        the Police report screen: the shop corrects it with LeadsOnline.
--      - every row that does go in the file is stamped 'reported'.
--
--    compliance_log.export_outcome is export bookkeeping like exported_at:
--    the immutability trigger only guards the snapshot fields, so it may be
--    set later. Rows exported before this patch keep NULL (= reported).
--
-- No RLS policy is touched. The trigger function is SECURITY DEFINER so the
-- void row is written whoever voids (owner / manager via voidLoanAction).

ALTER TABLE compliance_log DROP CONSTRAINT IF EXISTS compliance_log_event_type_check;
ALTER TABLE compliance_log ADD CONSTRAINT compliance_log_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'pawn_intake', 'pawn_redemption', 'pawn_forfeiture', 'buy_outright', 'buy_release', 'pawn_void'
  ]));

ALTER TABLE compliance_log
  ADD COLUMN IF NOT EXISTS export_outcome TEXT
    CHECK (export_outcome IS NULL OR export_outcome IN ('reported', 'withheld_void', 'void_notice'));

ALTER TABLE compliance_export_batches
  ADD COLUMN IF NOT EXISTS voided_after_report JSONB NOT NULL DEFAULT '[]'::jsonb;

-- At most one void row per ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_log_pawn_void
  ON compliance_log (source_id) WHERE event_type = 'pawn_void';

CREATE OR REPLACE FUNCTION compliance_log_pawn_void()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intake compliance_log%ROWTYPE;
BEGIN
  IF NEW.status <> 'voided' OR OLD.status = 'voided' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_intake
    FROM compliance_log
   WHERE source_table = 'loans'
     AND source_id = NEW.id
     AND tenant_id = NEW.tenant_id
     AND event_type = 'pawn_intake'
   ORDER BY occurred_at
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW; -- imported ticket: nothing of ours was reported
  END IF;

  INSERT INTO compliance_log (
    tenant_id, source_table, source_id, event_type,
    customer_snapshot, items_snapshot, amount
  ) VALUES (
    NEW.tenant_id, 'loans', NEW.id, 'pawn_void',
    v_intake.customer_snapshot, v_intake.items_snapshot, v_intake.amount
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_compliance_void ON loans;
CREATE TRIGGER trg_loans_compliance_void
  AFTER UPDATE OF status ON loans
  FOR EACH ROW
  EXECUTE FUNCTION compliance_log_pawn_void();
