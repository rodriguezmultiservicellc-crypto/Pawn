-- ───────────────────────────────────────────────────────────────────────────
-- 0089 — inventory import provenance: import_source + import_ref
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0088. Append-only.
--
-- The inventory importer (first source: Lightspeed Retail X-Series product
-- export) creates ONE inventory_items row per physical unit in stock. Each
-- row records where it came from so a re-run (or a resume after a timeout)
-- never creates the same piece twice:
--
--   import_source  'lightspeed'
--   import_ref     '<lightspeed product id>#<unit n>'   (n = 1..on-hand qty)
--
-- A re-import after stock went 2 → 3 adds unit #3 only. The unique index
-- covers soft-deleted rows too: a piece someone deleted is not resurrected
-- by the next import.
--
-- Additive columns + one index. No RLS change.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_inventory_import_ref;
--   ALTER TABLE inventory_items DROP COLUMN IF EXISTS import_ref,
--                               DROP COLUMN IF EXISTS import_source;
-- ============================================================================

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS import_source TEXT,
  ADD COLUMN IF NOT EXISTS import_ref    TEXT;

DO $$ BEGIN
  ALTER TABLE inventory_items
    ADD CONSTRAINT inventory_items_import_coherent
    CHECK ((import_source IS NULL) = (import_ref IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_import_ref
  ON inventory_items (tenant_id, import_source, import_ref)
  WHERE import_ref IS NOT NULL;

COMMENT ON COLUMN inventory_items.import_source IS
  'System this row was imported from (e.g. ''lightspeed''). NULL = created in Sol Pawn.';
COMMENT ON COLUMN inventory_items.import_ref IS
  'Source-system key for this physical unit, unique per tenant + source. Lightspeed: ''<product id>#<unit n>''.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0089-inventory-import-ref.sql
-- ============================================================================
