-- ───────────────────────────────────────────────────────────────────────────
-- 0099 — Legacy references on loans (import from a previous pawn system)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0098.
--
-- A shop that moves to Pawn brings its loan book with it. Each imported row
-- remembers the record it came from, so the import can be run again without
-- writing anything twice and any figure can be traced back to the old system:
--   loans.legacy_ref                  'xpawn:ticket:<Ticket Key>'
--   loan_collateral_items.legacy_ref  'xpawn:item:<Item Key>'
--   loan_events.legacy_ref            'xpawn:pay:<Payment Key>[:ext|:red]'
--                                     'xpawn:ticket:<Ticket Key>:<event>'
-- Same idea as customers.legacy_ref (0047) and inventory_items.import_ref.
--
-- NULL for every loan written in Pawn. The unique indexes are partial, so
-- they cost nothing for those rows.
--
-- RLS: no policy added or changed. The new columns are covered by the
-- existing policies of their tables.
--
-- Rollback
--   DROP INDEX IF EXISTS uq_loans_legacy_ref, uq_loan_collateral_legacy_ref,
--     uq_loan_events_legacy_ref;
--   ALTER TABLE loans DROP COLUMN IF EXISTS legacy_ref;
--   ALTER TABLE loan_collateral_items DROP COLUMN IF EXISTS legacy_ref;
--   ALTER TABLE loan_events DROP COLUMN IF EXISTS legacy_ref;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE loans ADD COLUMN IF NOT EXISTS legacy_ref TEXT;
ALTER TABLE loan_collateral_items ADD COLUMN IF NOT EXISTS legacy_ref TEXT;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS legacy_ref TEXT;

COMMENT ON COLUMN loans.legacy_ref IS
  'The record this loan was imported from (e.g. xpawn:ticket:18749). NULL for a loan written in Pawn. Unique per tenant.';
COMMENT ON COLUMN loan_collateral_items.legacy_ref IS
  'The record this collateral item was imported from (e.g. xpawn:item:25001). NULL for an item written in Pawn.';
COMMENT ON COLUMN loan_events.legacy_ref IS
  'The record this event was imported from (e.g. xpawn:pay:35063, xpawn:pay:35063:red, xpawn:ticket:18749:issued). NULL for an event written in Pawn.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_loans_legacy_ref
  ON loans (tenant_id, legacy_ref) WHERE legacy_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_collateral_legacy_ref
  ON loan_collateral_items (tenant_id, legacy_ref) WHERE legacy_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_events_legacy_ref
  ON loan_events (tenant_id, legacy_ref) WHERE legacy_ref IS NOT NULL;

NOTIFY pgrst, 'reload schema';
