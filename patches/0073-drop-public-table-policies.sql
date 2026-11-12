-- ───────────────────────────────────────────────────────────────────────────
-- 0073 — drop the whole-row public policies (step 2 of 2; review 2026-11-11)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna, ONLY AFTER the code that reads the
-- 0072 views is deployed (src/lib/tenant-resolver.ts reading public_tenants /
-- public_catalog_*). Applying it earlier takes the public landing page and
-- catalog offline until that deploy.
--
-- RLS CHANGE — explicitly approved by Eddy on 2026-11-11 ("all 7", item 3 of
-- REVIEW-2026-11-11.md, with the caveat that it touches RLS stated).
--
-- What this removes
--
--   The four policies that let anon and EVERY authenticated user read whole
--   rows of the base tables for a published shop:
--
--     tenants_public_landing_select                  (patches/0026)
--     inventory_items_public_catalog_select          (patches/0027)
--     inventory_item_photos_public_catalog_select    (patches/0027)
--     inventory_item_stones_public_catalog_select    (patches/0027)
--
-- What is NOT touched
--
--   Every staff / membership / portal policy on these tables stays exactly
--   as it is. Staff read their own shop's tenants + inventory rows through
--   tenants_select / the inventory staff policies, as before. Public pages
--   read the 0072 views.
--
-- After this, as anon:
--   /rest/v1/tenants?select=*          → []
--   /rest/v1/inventory_items?select=*  → []
--   /rest/v1/public_tenants            → published shops, public columns
--   /rest/v1/public_catalog_items      → catalog, public columns
--
-- Rollback (re-opens the exposure — only to restore service in an emergency)
--   Re-run the CREATE POLICY blocks from patches/0026 (lines 138-146) and
--   patches/0027 (lines 113-178).
-- ============================================================================

DROP POLICY IF EXISTS tenants_public_landing_select ON tenants;

DROP POLICY IF EXISTS inventory_items_public_catalog_select ON inventory_items;

DROP POLICY IF EXISTS inventory_item_photos_public_catalog_select
  ON inventory_item_photos;

DROP POLICY IF EXISTS inventory_item_stones_public_catalog_select
  ON inventory_item_stones;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0073-drop-public-table-policies.sql
-- ============================================================================
