-- 0119 — A repair photo taken at intake belongs to one of the ticket's items
-- (Eddy, 2026-11-26: repair items work like pawn items, each with its own
-- photos, uploaded from the browser).
--
-- New intake photos are uploaded by the browser straight to the repair-photos
-- bucket, in the shop's own folder (<tenant_id>/intake/<uuid>.<ext>; the
-- bucket's existing storage policies already allow staff to write there), and
-- createRepairTicketAction records them with the item they were taken for.
-- Older photos, and photos added on the ticket page later, have no item (NULL).
--
-- New nullable column only. No policy is added or changed.

ALTER TABLE repair_ticket_photos
  ADD COLUMN IF NOT EXISTS line_item_id UUID
    REFERENCES repair_ticket_line_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_photos_line_item
  ON repair_ticket_photos(line_item_id)
  WHERE line_item_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN repair_ticket_photos.line_item_id IS
  'The ticket item this intake photo shows; NULL for photos not tied to one item.';

NOTIFY pgrst, 'reload schema';
