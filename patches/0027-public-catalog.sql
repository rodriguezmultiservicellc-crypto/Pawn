-- ───────────────────────────────────────────────────────────────────────────
-- 0027 — public catalog (Phase 10 Path A, slice 2)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0026 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds two columns + three SELECT-only RLS policies that expose a
--   per-tenant public catalog at /s/<slug>/catalog (and /<sku> for
--   detail). Same three-AND-flag pattern as 0026's landing-page policy,
--   plus a new tenant column gating the catalog independently:
--
--     tenants.public_catalog_enabled   BOOLEAN NOT NULL DEFAULT FALSE
--     inventory_items.is_hidden_from_catalog
--                                      BOOLEAN NOT NULL DEFAULT FALSE
--
--   The RLS policies expose:
--     - inventory_items rows where the parent tenant has the landing
--       AND catalog flags both on AND has_retail AND is_active, AND
--       the row is available, not hidden, has a list_price, and is
--       not soft-deleted
--     - inventory_item_photos rows whose parent item passes the gate
--     - inventory_item_stones rows whose parent item passes the gate
--
--   A new partial index on inventory_items keeps the list query cheap
--   regardless of total inventory size — only available, non-hidden,
--   priced, non-deleted rows land in the index.
--
-- Why two flags (not "landing implies catalog")
--
--   An operator may want a published landing page with no catalog yet
--   (photos missing, prices not set). Decoupling the catalog flag lets
--   them ship the landing without exposing inventory.
--
-- Why a per-item hide flag (and not just status='available')
--
--   Auto-publish on status='available' AND list_price IS NOT NULL is the
--   default — operators get a populated catalog the moment they flip the
--   tenant flag. The hide flag covers the cases auto doesn't (consigned
--   under negotiation, photos pending retake, "back room" stock).
--
-- Photo + stone policies join through inventory_items
--
--   No tenant_id check is needed on the photos/stones policies because
--   the inventory_items SELECT in the EXISTS clause is already RLS-
--   gated (and the policy explicitly re-validates the per-tenant gate
--   for defense-in-depth).
--
-- Followups (NOT in this patch)
--
--   - Run `npm run db:types` after applying so src/types/database.ts
--     picks up the new columns.
--   - The /settings/general form learns about the new flag in the same
--     PR; the inventory edit + create forms learn about is_hidden_from_
--     catalog in the same PR.
--
-- Rollback
--
--   DROP POLICY IF EXISTS inventory_item_stones_public_catalog_select
--     ON inventory_item_stones;
--   DROP POLICY IF EXISTS inventory_item_photos_public_catalog_select
--     ON inventory_item_photos;
--   DROP POLICY IF EXISTS inventory_items_public_catalog_select
--     ON inventory_items;
--   DROP INDEX IF EXISTS idx_inventory_public_catalog;
--   ALTER TABLE inventory_items
--     DROP COLUMN IF EXISTS is_hidden_from_catalog;
--   ALTER TABLE tenants
--     DROP COLUMN IF EXISTS public_catalog_enabled;
--   The columns have no FKs and the policies + index are additive — clean rollback.
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS public_catalog_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS is_hidden_from_catalog BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.public_catalog_enabled IS
  'When TRUE (and public_landing_enabled + has_retail + is_active are '
  'all TRUE), the public catalog at /s/<public_slug>/catalog is rendered. '
  'Decoupled from public_landing_enabled so a tenant can publish a '
  'landing page without exposing inventory.';

COMMENT ON COLUMN inventory_items.is_hidden_from_catalog IS
  'When TRUE, this item is excluded from the public catalog even if it '
  'meets the auto-publish criteria (status=available AND list_price IS '
  'NOT NULL AND deleted_at IS NULL). Per-item escape hatch for '
  'consigned-under-negotiation, photos-pending-retake, or back-room '
  'stock. Defaults to FALSE so the catalog populates immediately on flag '
  'flip.';

-- Partial index: tight on the common query path (list page, ordered by
-- created_at desc, scoped to one tenant). Filters mirror the RLS USING
-- clause so the planner picks this index for both anon-public reads and
-- staff-side "what's currently public" introspection.
CREATE INDEX IF NOT EXISTS idx_inventory_public_catalog
  ON inventory_items (tenant_id, created_at DESC)
  WHERE status = 'available'
    AND is_hidden_from_catalog = FALSE
    AND list_price IS NOT NULL
    AND deleted_at IS NULL;

-- ── Public-read RLS policies ───────────────────────────────────────────
--
-- inventory_items, inventory_item_photos, inventory_item_stones already
-- have RLS enabled (0003-customers-inventory.sql). These additive
-- policies grant the anon role row visibility ONLY when the parent
-- tenant + per-item gates all pass. Existing staff policies are
-- untouched.

DROP POLICY IF EXISTS inventory_items_public_catalog_select ON inventory_items;
CREATE POLICY inventory_items_public_catalog_select ON inventory_items
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.id = inventory_items.tenant_id
        AND t.public_landing_enabled = TRUE
        AND t.public_catalog_enabled = TRUE
        AND t.has_retail = TRUE
        AND t.is_active = TRUE
    )
    AND inventory_items.status = 'available'
    AND inventory_items.is_hidden_from_catalog = FALSE
    AND inventory_items.list_price IS NOT NULL
    AND inventory_items.deleted_at IS NULL
  );

DROP POLICY IF EXISTS inventory_item_photos_public_catalog_select
  ON inventory_item_photos;
CREATE POLICY inventory_item_photos_public_catalog_select
  ON inventory_item_photos
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM inventory_items i
      JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = inventory_item_photos.item_id
        AND t.public_landing_enabled = TRUE
        AND t.public_catalog_enabled = TRUE
        AND t.has_retail = TRUE
        AND t.is_active = TRUE
        AND i.status = 'available'
        AND i.is_hidden_from_catalog = FALSE
        AND i.list_price IS NOT NULL
        AND i.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS inventory_item_stones_public_catalog_select
  ON inventory_item_stones;
CREATE POLICY inventory_item_stones_public_catalog_select
  ON inventory_item_stones
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM inventory_items i
      JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = inventory_item_stones.item_id
        AND t.public_landing_enabled = TRUE
        AND t.public_catalog_enabled = TRUE
        AND t.has_retail = TRUE
        AND t.is_active = TRUE
        AND i.status = 'available'
        AND i.is_hidden_from_catalog = FALSE
        AND i.list_price IS NOT NULL
        AND i.deleted_at IS NULL
    )
  );

-- Tell PostgREST to pick up the new columns + policies without a manual restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0027-public-catalog.sql
-- ============================================================================
