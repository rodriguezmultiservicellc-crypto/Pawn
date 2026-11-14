-- ───────────────────────────────────────────────────────────────────────────
-- 0080 — Product feeds (PLAN-2026-11-13 Phase 4)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0079.
--
-- A shop can publish its catalog as a Google Merchant Center / Meta catalog
-- feed at /s/<slug>/feeds/products.xml.
--
--   settings.product_feed_enabled   off by default; the owner turns it on
--   public_catalog_items            + condition, updated_at (appended; the
--                                   rows it returns are unchanged)
--   public_store_settings           + feed_enabled (appended)
--   public_sold_items  (new view)   pieces that WERE for sale online and are
--                                   now sold (last 90 days) or in someone's
--                                   checkout, so an old feed link or search
--                                   result shows "sold" instead of a 404
--
-- RLS: no table policy is added or changed. The new view follows the 0072
-- pattern (security_invoker = false, anon SELECT only) and exposes no cost,
-- consignor, customer or sale columns — only what the item page already
-- showed while the piece was for sale.
--
-- Rollback
--   DROP VIEW IF EXISTS public_sold_items;
--   (re-run the 0078 definitions of public_catalog_items and
--    public_store_settings — CREATE OR REPLACE cannot drop columns, so
--    DROP VIEW public_catalog_photos, public_catalog_stones,
--    public_catalog_items first and re-create all three from 0072/0078)
--   ALTER TABLE settings DROP COLUMN IF EXISTS product_feed_enabled;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS product_feed_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Same rows as 0078; two columns appended for the feed.
CREATE OR REPLACE VIEW public_catalog_items
WITH (security_invoker = false) AS
SELECT
  i.id, i.tenant_id, i.sku, i.description, i.category, i.brand, i.model,
  i.serial_number, i.metal, i.karat, i.weight_grams, i.weight_dwt,
  i.list_price, i.created_at,
  i.condition, i.updated_at
FROM inventory_items i
JOIN tenants t ON t.id = i.tenant_id
WHERE t.public_landing_enabled = TRUE
  AND t.public_catalog_enabled = TRUE
  AND t.has_retail = TRUE
  AND t.is_active = TRUE
  AND i.status = 'available'
  AND i.reserved_order_id IS NULL
  AND i.is_hidden_from_catalog = FALSE
  AND i.list_price IS NOT NULL
  AND i.deleted_at IS NULL;

CREATE OR REPLACE VIEW public_store_settings
WITH (security_invoker = false) AS
SELECT
  s.tenant_id,
  (s.online_checkout_enabled AND t.public_catalog_enabled AND t.has_retail) AS checkout_enabled,
  s.online_pickup_enabled  AS pickup_enabled,
  s.online_ship_enabled    AS ship_enabled,
  s.ship_flat_rate,
  s.ship_free_over,
  s.online_order_max       AS order_max,
  s.store_return_policy_en,
  s.store_return_policy_es,
  s.store_shipping_policy_en,
  s.store_shipping_policy_es,
  s.store_tagline_en,
  s.store_tagline_es,
  s.store_accent_color,
  (s.product_feed_enabled AND t.public_catalog_enabled AND t.has_retail) AS feed_enabled
FROM settings s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.public_landing_enabled = TRUE
  AND t.public_slug IS NOT NULL
  AND t.is_active = TRUE;

-- Pieces that are no longer for sale but whose link may still be out there.
-- sold = TRUE: sold in the last 90 days. sold = FALSE: in a shopper's
-- checkout right now (it comes back if they do not pay).
-- Layaway / police-hold pieces are deliberately NOT here: a buy-hold piece
-- was never public, and the two share status 'held'.
CREATE OR REPLACE VIEW public_sold_items
WITH (security_invoker = false) AS
SELECT
  i.tenant_id,
  i.sku,
  i.description,
  i.category,
  i.metal,
  i.karat,
  (i.status = 'sold') AS sold
FROM inventory_items i
JOIN tenants t ON t.id = i.tenant_id
WHERE t.public_landing_enabled = TRUE
  AND t.public_catalog_enabled = TRUE
  AND t.has_retail = TRUE
  AND t.is_active = TRUE
  AND i.is_hidden_from_catalog = FALSE
  AND i.list_price IS NOT NULL
  AND i.deleted_at IS NULL
  AND (
    (i.status = 'sold' AND i.sold_at > now() - interval '90 days')
    OR (i.status = 'available' AND i.reserved_order_id IS NOT NULL)
  );

COMMENT ON VIEW public_sold_items IS
  'Recently sold (90 days) or checkout-reserved pieces that were in the public catalog: '
  'lets an old link show "sold" instead of a 404. Description columns only.';

REVOKE ALL ON public_sold_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public_sold_items TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
