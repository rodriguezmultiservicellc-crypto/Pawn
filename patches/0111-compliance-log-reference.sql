-- 0111 — What the LeadsOnline XML needs that compliance_log did not keep.
--
-- The upload file (the format xPawn has sent LeadsOnline since 2025, files
-- in Dropbox\pawn police) carries per ticket a ticket_number and the clerk's
-- initials. compliance_log (rule 15: the police export reads ONLY this
-- table) had neither:
--
--   compliance_log.reference_number  the ticket as the agency knows it: a
--                                    pawn's ticket number, a buy's first
--                                    item SKU (a buy has no ticket number)
--   compliance_log.clerk             initials of whoever wrote it ("ER")
--
-- Both written at insert by the intake actions; the 0108 void trigger copies
-- them from the intake row. Existing rows: reference_number is filled from
-- the record they point at (a ticket number never changes); clerk stays
-- NULL (not recorded at the time).
--
-- export_outcome gains 'reported_void': xPawn never held a voided ticket
-- back — it sent it once with <void>Y</void>, and LeadsOnline took it. So a
-- ticket voided before the export goes in the file as a void (both rows
-- stamped 'reported_void'); one voided after it was reported goes again
-- with void Y ('void_notice'). 'withheld_void' stays allowed for rows
-- stamped before this patch.
--
-- Both new columns are export metadata outside the immutability trigger's
-- snapshot list (as exported_at is). No RLS policy is touched.

ALTER TABLE compliance_log
  ADD COLUMN IF NOT EXISTS reference_number TEXT,
  ADD COLUMN IF NOT EXISTS clerk TEXT;

ALTER TABLE compliance_log DROP CONSTRAINT IF EXISTS compliance_log_export_outcome_check;
ALTER TABLE compliance_log ADD CONSTRAINT compliance_log_export_outcome_check
  CHECK (export_outcome IS NULL OR export_outcome IN ('reported', 'withheld_void', 'void_notice', 'reported_void'));

UPDATE compliance_log c SET reference_number = l.ticket_number
  FROM loans l
 WHERE c.source_table = 'loans' AND c.source_id = l.id AND c.reference_number IS NULL;

UPDATE compliance_log c SET reference_number = i.sku
  FROM inventory_items i
 WHERE c.source_table = 'inventory_items' AND c.source_id = i.id AND c.reference_number IS NULL;

-- The void row carries its ticket's number and clerk too.
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
    customer_snapshot, items_snapshot, amount, reference_number, clerk
  ) VALUES (
    NEW.tenant_id, 'loans', NEW.id, 'pawn_void',
    v_intake.customer_snapshot, v_intake.items_snapshot, v_intake.amount,
    COALESCE(v_intake.reference_number, NEW.ticket_number), v_intake.clerk
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
