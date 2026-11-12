-- ───────────────────────────────────────────────────────────────────────────
-- 0072 — column-restricted public views (step 1 of 2; review 2026-11-11)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna. Additive: four views + grants.
-- No existing policy, table or column is changed here. Step 2 is 0073.
--
-- The problem
--
--   patches/0026 and 0027 publish the landing page and catalog with RLS
--   policies granted TO anon, authenticated on the BASE TABLES:
--
--     tenants_public_landing_select            ON tenants
--     inventory_items_public_catalog_select    ON inventory_items
--     inventory_item_photos_public_catalog_select
--     inventory_item_stones_public_catalog_select
--
--   RLS decides which ROWS are visible, not which COLUMNS. The "public
--   column allowlist" lived only in src/lib/tenant-resolver.ts — but the
--   anon key is public, and anyone can call PostgREST with it directly:
--
--     GET /rest/v1/inventory_items?select=*
--       → cost_basis, acquired_cost, notes, source_loan_id,
--         consignment_min_price, consignor_id … for every catalog item
--     GET /rest/v1/tenants?select=*
--       → every column of a published shop, license_key included
--
--   Confirmed against the live database on 2026-11-11 with the anon key.
--   Because the policies are also TO authenticated, any signed-in user of
--   ANY shop (a portal customer included) could read the same.
--
-- The fix
--
--   Public reads go through views that select ONLY the public columns and
--   carry the same publish gates. anon / authenticated get SELECT on the
--   views and nothing else. The views are deliberately NOT security_invoker:
--   they run with their owner's rights, which is what lets them read the
--   base tables after 0073 removes the anon policies — the view body is the
--   whole of what an anonymous caller can see.
--
--   Columns are exactly PUBLIC_TENANT_COLUMNS / PUBLIC_CATALOG_COLUMNS from
--   tenant-resolver.ts (plus tenant_id on items, which the catalog filters
--   on and which is already public as tenants.id).
--
-- Order of operations (no downtime)
--   1. apply 0072 (this file)            — views exist, old policies remain
--   2. deploy code that reads the views
--   3. apply 0073                        — old policies dropped
--
-- Rollback
--   DROP VIEW IF EXISTS public_catalog_stones;
--   DROP VIEW IF EXISTS public_catalog_photos;
--   DROP VIEW IF EXISTS public_catalog_items;
--   DROP VIEW IF EXISTS public_tenants;
-- ============================================================================

-- ── Published shops ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public_tenants
WITH (security_invoker = false) AS
SELECT
  t.id,
  t.name,
  t.dba,
  t.public_slug,
  t.public_about,
  t.public_hours,
  t.address,
  t.city,
  t.state,
  t.zip,
  t.phone,
  t.email,
  t.logo_url,
  t.has_pawn,
  t.has_repair,
  t.has_retail,
  t.public_catalog_enabled
FROM tenants t
WHERE t.public_landing_enabled = TRUE
  AND t.public_slug IS NOT NULL
  AND t.is_active = TRUE;

COMMENT ON VIEW public_tenants IS
  'Public projection of tenants: published landing pages only, public '
  'columns only. The ONLY way anon reads a tenant (0073 drops the table '
  'policy). Add a column here only if it is safe on an unauthenticated page.';

-- ── Catalog items ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public_catalog_items
WITH (security_invoker = false) AS
SELECT
  i.id,
  i.tenant_id,
  i.sku,
  i.description,
  i.category,
  i.brand,
  i.model,
  i.serial_number,
  i.metal,
  i.karat,
  i.weight_grams,
  i.weight_dwt,
  i.list_price,
  i.created_at
FROM inventory_items i
JOIN tenants t ON t.id = i.tenant_id
WHERE t.public_landing_enabled = TRUE
  AND t.public_catalog_enabled = TRUE
  AND t.has_retail = TRUE
  AND t.is_active = TRUE
  AND i.status = 'available'
  AND i.is_hidden_from_catalog = FALSE
  AND i.list_price IS NOT NULL
  AND i.deleted_at IS NULL;

COMMENT ON VIEW public_catalog_items IS
  'Public projection of inventory_items: published, available, priced, '
  'not hidden. Never exposes cost_basis / acquired_cost / notes / '
  'source_loan_id / consignor or consignment fields.';

-- ── Photos + stones of catalog items ───────────────────────────────────────
-- Joined through public_catalog_items so the publish gates are stated once.
CREATE OR REPLACE VIEW public_catalog_photos
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.item_id,
  p.storage_path,
  p.position,
  p.is_primary,
  p.caption
FROM inventory_item_photos p
JOIN public_catalog_items i ON i.id = p.item_id
WHERE p.deleted_at IS NULL;

CREATE OR REPLACE VIEW public_catalog_stones
WITH (security_invoker = false) AS
SELECT
  s.item_id,
  s.count,
  s.stone_type,
  s.cut,
  s.carat,
  s.is_total_carat,
  s.color,
  s.clarity,
  s.position
FROM inventory_item_stones s
JOIN public_catalog_items i ON i.id = s.item_id
WHERE s.deleted_at IS NULL;

-- ── Grants: SELECT only ────────────────────────────────────────────────────
-- Supabase's default privileges hand new objects in `public` to anon and
-- authenticated with ALL. Take that back and grant read alone.
REVOKE ALL ON public_tenants        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public_catalog_items  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public_catalog_photos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public_catalog_stones FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public_tenants        TO anon, authenticated, service_role;
GRANT SELECT ON public_catalog_items  TO anon, authenticated, service_role;
GRANT SELECT ON public_catalog_photos TO anon, authenticated, service_role;
GRANT SELECT ON public_catalog_stones TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0072-public-views.sql
-- ============================================================================
