-- ============================================================================
-- PAWN — CUSTOMER PAWN FIELDS (Phase 1, follow-up)
-- File:    patches/0004-customer-pawn-fields.sql
-- Date:    2026-04-26
-- Purpose: Add the physical-description + employment fields the FL pawn
--          statute (and most state pawn statutes) require on the customer
--          record. Captured at customer record level — every pawn intake
--          and buy-outright will snapshot these into compliance_log when
--          Phase 2 lands so police-report exports stay deterministic.
--
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0001-foundation.sql,
--           0002-fix-create-tenant-ambiguous-column.sql, and
--           0003-customers-inventory.sql have already run.
--           Append-only — never edit prior migrations.
--
-- Field notes:
--   - height_inches: total inches (UI splits into feet + inches). Single
--     INTEGER keeps DB simple and analysis-friendly.
--   - weight_lbs: pounds, INTEGER.
--   - sex: TEXT (no enum) so jurisdictions can record M / F / X / U / etc.
--     LeadsOnline upload format normalizes at export time.
--   - hair_color / eye_color: short TEXT (e.g. 'BRN', 'BLU', 'HAZ').
--     Free-text on purpose — color codes vary by jurisdiction.
--   - identifying_marks: long TEXT for scars, tattoos, piercings, etc.
--   - place_of_employment: TEXT — company / employer name.
-- ============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS height_inches      INTEGER CHECK (height_inches IS NULL OR (height_inches BETWEEN 12 AND 108)),
  ADD COLUMN IF NOT EXISTS weight_lbs         INTEGER CHECK (weight_lbs IS NULL OR (weight_lbs BETWEEN 1 AND 999)),
  ADD COLUMN IF NOT EXISTS sex                TEXT,
  ADD COLUMN IF NOT EXISTS hair_color         TEXT,
  ADD COLUMN IF NOT EXISTS eye_color          TEXT,
  ADD COLUMN IF NOT EXISTS identifying_marks  TEXT,
  ADD COLUMN IF NOT EXISTS place_of_employment TEXT;

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0004-customer-pawn-fields.sql
-- ============================================================================
