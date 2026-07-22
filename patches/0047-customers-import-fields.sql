-- ============================================================================
-- PAWN — CUSTOMER IMPORT FIELDS (race + legacy import ref)
-- File:    patches/0047-customers-import-fields.sql
-- Date:    2026-07-22
-- Purpose: Support the one-time xPawn Customers.csv import + future migrations:
--   1. customers.race  — physical-description field the FL pawnbroker /
--      LeadsOnline report expects; xPawn exports it and Sol Pawn had no column.
--   2. customers.legacy_ref + import_source — provenance for imported rows so
--      the import is idempotent (re-runnable) and reconcilable back to the
--      source system. A partial UNIQUE index on (tenant_id, legacy_ref) makes
--      a re-run skip already-imported customers instead of duplicating them.
--
-- Apply to: existing project (customers table from 0002-customers.sql).
-- No RLS change — the existing customers policies already cover new columns.
-- ============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS race          TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS legacy_ref    TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS import_source TEXT;

COMMENT ON COLUMN customers.race IS
  'Physical-description race/ethnicity (FL pawnbroker + LeadsOnline reporting).';
COMMENT ON COLUMN customers.legacy_ref IS
  'External source key for imported customers, e.g. ''xpawn:1842''. Unique per tenant.';
COMMENT ON COLUMN customers.import_source IS
  'Origin system for imported customers, e.g. ''xpawn''. NULL for native records.';

-- Idempotency guard: one legacy_ref per tenant among live rows. Partial so it
-- ignores native customers (legacy_ref IS NULL) and soft-deleted rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customers_tenant_legacy_ref
  ON customers(tenant_id, legacy_ref)
  WHERE legacy_ref IS NOT NULL AND deleted_at IS NULL;

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS uniq_customers_tenant_legacy_ref;
--   ALTER TABLE customers DROP COLUMN IF EXISTS import_source;
--   ALTER TABLE customers DROP COLUMN IF EXISTS legacy_ref;
--   ALTER TABLE customers DROP COLUMN IF EXISTS race;
-- END 0047-customers-import-fields.sql
-- ============================================================================
