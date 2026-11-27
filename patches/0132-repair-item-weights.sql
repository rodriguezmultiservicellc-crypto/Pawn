-- 0132 — The technician's weights on each repair item (Eddy, 2026-11-27:
-- "have tech confirm receive weight and karat and when finished enter
-- ending weight").
--
--   received_*  the tech weighs the piece and reads its karat when they take
--               it to the bench (before any time goes on it). Compared with
--               the intake weight / karat; a difference is shown, not refused.
--   final_*     the weight when the work is done (solder adds, sizing down
--               removes): entered with "Finish", before QA.
--
-- Weights are numeric(10,4) grams (rule 11). The existing lock trigger
-- (patches/0046) freezes them with the rest of the item once the ticket is
-- locked. No RLS policy is touched.

ALTER TABLE repair_ticket_line_items
  ADD COLUMN IF NOT EXISTS received_weight_grams NUMERIC(10,4)
    CHECK (received_weight_grams IS NULL OR received_weight_grams > 0),
  ADD COLUMN IF NOT EXISTS received_karat TEXT,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS final_weight_grams NUMERIC(10,4)
    CHECK (final_weight_grams IS NULL OR final_weight_grams > 0),
  ADD COLUMN IF NOT EXISTS final_weighed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_weighed_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN repair_ticket_line_items.received_weight_grams IS
  'Weight the technician measured on receiving the item (grams).';
COMMENT ON COLUMN repair_ticket_line_items.final_weight_grams IS
  'Weight when the work was finished (grams).';
