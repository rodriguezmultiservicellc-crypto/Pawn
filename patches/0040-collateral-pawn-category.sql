-- ───────────────────────────────────────────────────────────────────────────
-- 0040 — Move pawn intake category from loans → loan_collateral_items
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0039 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- 0039 added pawn_category_slug + pawn_subcategory_slug to public.loans
-- on the assumption that the wizard step 1 picker captured a single
-- category for the whole pawn ticket. That was wrong: the operator
-- can pawn a Jewelry→Ring AND an Electronics→Phone in the same loan,
-- and each item carries its own category.
--
-- This migration:
--   1. Drops loans.pawn_category_slug + loans.pawn_subcategory_slug
--      (and the now-orphan idx_loans_pawn_category index).
--   2. Adds equivalent columns to loan_collateral_items so each row
--      gets its own slug pair.
--   3. Adds an analytics index on loan_collateral_items
--      (tenant_id, pawn_category_slug, created_at DESC) for category-
--      level rollups across the whole book.
--
-- Same SLUG-SNAPSHOT, NO-FK reasoning as 0039 — see that migration's
-- doc block. Slugs are frozen on intake; renaming a category in
-- pawn_intake_categories doesn't follow historical items.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- 1. UNDO 0039
-- ───────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_loans_pawn_category;

ALTER TABLE public.loans
  DROP COLUMN IF EXISTS pawn_category_slug,
  DROP COLUMN IF EXISTS pawn_subcategory_slug;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. ADD TO loan_collateral_items
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS pawn_category_slug TEXT NULL,
  ADD COLUMN IF NOT EXISTS pawn_subcategory_slug TEXT NULL;

COMMENT ON COLUMN public.loan_collateral_items.pawn_category_slug IS
  'Slug snapshot of the top-level pawn_intake_categories row picked '
  'when this collateral item was added to the ticket. NULL on pre-0040 '
  'rows. Frozen for the life of the item — if the operator renames the '
  'category later, this column does not follow. Join to '
  'pawn_intake_categories on (tenant_id, slug) for live label lookup; '
  'fall back to the raw slug if no row matches.';

COMMENT ON COLUMN public.loan_collateral_items.pawn_subcategory_slug IS
  'Slug snapshot of the sub-category, when the picked top-level has '
  'subs. NULL when the top-level has no subs (e.g., general) OR on '
  'pre-0040 rows. Same freeze + display-fallback rules as '
  'pawn_category_slug.';

-- Analytics index — "show me the collateral distribution by category
-- for this tenant over the last 90 days". Partial so we don't bloat
-- the index with the long pre-0040 NULL tail.
CREATE INDEX IF NOT EXISTS idx_loan_collateral_items_pawn_category
  ON public.loan_collateral_items
     (tenant_id, pawn_category_slug, created_at DESC)
  WHERE pawn_category_slug IS NOT NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
-- After running:
--
--   \d public.loans
--     pawn_category_slug + pawn_subcategory_slug should be GONE.
--
--   \d public.loan_collateral_items
--     pawn_category_slug + pawn_subcategory_slug should be PRESENT.
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename='loan_collateral_items'
--      AND indexname='idx_loan_collateral_items_pawn_category';
-- ───────────────────────────────────────────────────────────────────────────
