-- 0114 — A pawned item can have several photos (Eddy, 2026-11-25: "I'm
-- bound to only 1 photo, I want to put more").
--
-- loan_collateral_items.photo_path stays the MAIN photo — every reader (the
-- ticket page, forfeit, the police export snapshot) keeps working on it
-- unchanged. The other photos, in the clerk's order, go in
-- extra_photo_paths. At most 6 in all (src/lib/uploads/intake-photos,
-- INTAKE_PHOTO_MAX), so at most 5 extra.
--
-- The files are uploaded by the browser into the shop's own folder of the
-- private inventory-photos bucket (<tenant_id>/intake/<uuid>.<ext>), which
-- the existing inventory_photos_storage_write policy already allows staff to
-- do. No policy is added or changed; this table's RLS already covers the new
-- column.
--
-- Buy outright needs nothing here: a buy's photos are inventory_item_photos
-- rows, which already allow many per item.
--
-- Existing rows: the default '{}' (no extra photos). Nothing to backfill.

ALTER TABLE loan_collateral_items
  ADD COLUMN IF NOT EXISTS extra_photo_paths TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE loan_collateral_items
  DROP CONSTRAINT IF EXISTS loan_collateral_items_extra_photos_max;
ALTER TABLE loan_collateral_items
  ADD CONSTRAINT loan_collateral_items_extra_photos_max
  CHECK (cardinality(extra_photo_paths) <= 5);

COMMENT ON COLUMN loan_collateral_items.extra_photo_paths IS
  'Photos of the item after the main one (photo_path), in the clerk''s order. Paths in the inventory-photos bucket. At most 5.';
