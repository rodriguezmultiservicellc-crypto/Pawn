-- ───────────────────────────────────────────────────────────────────────────
-- 0082 — Quick sale buttons linked to inventory
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0081.
--
-- A button can now stand for a PRODUCT the shop stocks many units of
-- (watch batteries, chains, cloths). Every inventory row is one physical
-- unit, so the product is "available units with this description and
-- category". A tap on the POS adds the oldest such unit as a normal
-- inventory line, so the sale marks it sold exactly like a scan.
--
--   inventory_item_id   the unit the owner picked when creating the button
--                       (reference only; it may sell — the match key stays)
--   match_description   lower(btrim(description)) of that unit
--   match_category      its category
--
-- Plain buttons (name + price, 0081) keep all three NULL.
-- RLS: no policy change (columns on an existing table).
--
-- Rollback
--   ALTER TABLE quick_sale_buttons DROP CONSTRAINT IF EXISTS quick_sale_buttons_link_complete,
--     DROP COLUMN IF EXISTS match_category, DROP COLUMN IF EXISTS match_description,
--     DROP COLUMN IF EXISTS inventory_item_id;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE quick_sale_buttons
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_description TEXT
    CHECK (match_description IS NULL OR (match_description = lower(btrim(match_description)) AND length(match_description) > 0)),
  ADD COLUMN IF NOT EXISTS match_category inventory_category;

ALTER TABLE quick_sale_buttons DROP CONSTRAINT IF EXISTS quick_sale_buttons_link_complete;
ALTER TABLE quick_sale_buttons ADD CONSTRAINT quick_sale_buttons_link_complete
  CHECK ((match_description IS NULL) = (match_category IS NULL));

COMMENT ON COLUMN quick_sale_buttons.match_description IS
  'Linked buttons: available inventory units whose lower(btrim(description)) equals this, in match_category, are the stock a tap sells from (oldest first).';

NOTIFY pgrst, 'reload schema';
