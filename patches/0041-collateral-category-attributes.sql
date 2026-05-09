-- ───────────────────────────────────────────────────────────────────────────
-- 0041 — Per-category attribute columns on loan_collateral_items
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0040 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- 0040 added pawn_category_slug + pawn_subcategory_slug per row, but the
-- row's *content* fields stayed jewelry-specific (metal_type, karat,
-- weight_grams). Different categories need different attributes:
--
--   Jewelry     → metal_type, karat, weight_grams (already present)
--   Firearms    → make, model, caliber, serial number, type,
--                 barrel length, action type, capacity
--   Electronics → brand, model, serial / IMEI
--   Tools       → brand, model
--   General     → none (description + est_value carry it)
--
-- We use DEDICATED COLUMNS instead of a JSONB attributes blob because:
--   (a) FL Ch. 539 police-report exports must filter on serial number
--       for firearms — typed columns make that query trivial;
--   (b) operator-facing queries (e.g., "find all Glock 19s in inventory")
--       benefit from indexes on dedicated columns;
--   (c) JSONB hides the schema from the operator's mental model.
--
-- All columns are NULLABLE — historical rows have them empty, future
-- rows set only the columns relevant to their picked category.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- FIREARM ATTRIBUTES
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS firearm_make TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_model TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_caliber TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_serial_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_barrel_length_inches NUMERIC(6,2) NULL,
  ADD COLUMN IF NOT EXISTS firearm_action_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_capacity INTEGER NULL;

-- Constrain firearm_type to a known set. NULL still allowed for non-
-- firearm rows.
ALTER TABLE public.loan_collateral_items
  DROP CONSTRAINT IF EXISTS loan_collateral_items_firearm_type_chk;
ALTER TABLE public.loan_collateral_items
  ADD CONSTRAINT loan_collateral_items_firearm_type_chk
  CHECK (
    firearm_type IS NULL
    OR firearm_type IN ('handgun', 'rifle', 'shotgun', 'other')
  );

COMMENT ON COLUMN public.loan_collateral_items.firearm_make IS
  'Manufacturer (Glock, Smith & Wesson, Ruger). NULL for non-firearm '
  'rows. Captured at intake when pawn_category_slug = ''firearms''.';

COMMENT ON COLUMN public.loan_collateral_items.firearm_serial_number IS
  'Serial number stamped on the receiver/frame. Required for FL Ch. 539 '
  'police-report exports — a row with pawn_category_slug=''firearms'' '
  'and a NULL serial is a data-quality bug, NOT a valid intake.';

COMMENT ON COLUMN public.loan_collateral_items.firearm_type IS
  'High-level classification — handgun / rifle / shotgun / other. '
  'CHECK-constrained.';

-- Index for "look up by serial number" — police-report queries + the
-- "is this firearm already in our system?" check on intake.
CREATE INDEX IF NOT EXISTS idx_loan_collateral_items_firearm_serial
  ON public.loan_collateral_items
     (tenant_id, firearm_serial_number)
  WHERE firearm_serial_number IS NOT NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- ELECTRONICS ATTRIBUTES
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS electronic_brand TEXT NULL,
  ADD COLUMN IF NOT EXISTS electronic_model TEXT NULL,
  ADD COLUMN IF NOT EXISTS electronic_serial TEXT NULL;

COMMENT ON COLUMN public.loan_collateral_items.electronic_serial IS
  'Serial number OR IMEI for phones / tablets / laptops. Single column '
  'covers both because the form doesn''t need to disambiguate at intake '
  '— operators paste whatever the device shows.';

CREATE INDEX IF NOT EXISTS idx_loan_collateral_items_electronic_serial
  ON public.loan_collateral_items
     (tenant_id, electronic_serial)
  WHERE electronic_serial IS NOT NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- TOOL ATTRIBUTES
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS tool_brand TEXT NULL,
  ADD COLUMN IF NOT EXISTS tool_model TEXT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
-- After running:
--
--   \d public.loan_collateral_items
--     should show 13 new columns total (8 firearm + 3 electronic + 2 tool).
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.loan_collateral_items'::regclass
--      AND conname = 'loan_collateral_items_firearm_type_chk';
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename='loan_collateral_items'
--      AND indexname IN (
--        'idx_loan_collateral_items_firearm_serial',
--        'idx_loan_collateral_items_electronic_serial'
--      );
-- ───────────────────────────────────────────────────────────────────────────
