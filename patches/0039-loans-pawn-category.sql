-- ───────────────────────────────────────────────────────────────────────────
-- 0039 — Persist pawn intake category on loans
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0038 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- The /pawn/new wizard step 1 (added in 0037+0038) makes the operator
-- pick a top-level pawn intake category and an optional sub-category
-- before the rest of the form reveals. Today the form already submits
-- pawn_category + pawn_subcategory as hidden inputs but the server
-- action drops them. This migration adds the columns so the server
-- action can persist them.
--
-- DESIGN — SLUGS, NOT FKs
-- ───────────────────────
-- We store slug strings (snapshot at intake time) NOT foreign keys to
-- pawn_intake_categories. Reasons:
--
--  1. CLAUDE.md rule 14: pawn ticket cores freeze on print. The
--     category is part of the ticket "what was pawned" identity. If
--     the operator later renames the slug ('rings' → 'ring') or
--     deactivates the category, the historical loan must keep showing
--     what it showed when it was issued.
--
--  2. pawn_intake_categories rows soft-delete via deleted_at. A FK
--     with ON DELETE RESTRICT would block soft-deletes; ON DELETE
--     SET NULL would forget the category entirely. A slug snapshot
--     keeps the historical fact intact in either case.
--
--  3. Display joins from loans → pawn_intake_categories still work
--     for live categories (look up by tenant_id + slug). When the
--     category has been deleted/renamed, the UI falls back to showing
--     the raw slug — graceful degradation.
--
-- Both columns are nullable. Loans pre-migration have no category and
-- stay that way. Voice intake auto-picks 'general' so all forward
-- loans get a slug. Some categories (e.g., 'general' itself) have no
-- sub-categories — pawn_subcategory_slug stays NULL for those.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS pawn_category_slug TEXT NULL,
  ADD COLUMN IF NOT EXISTS pawn_subcategory_slug TEXT NULL;

COMMENT ON COLUMN public.loans.pawn_category_slug IS
  'Slug snapshot of the top-level pawn_intake_categories row picked at '
  'intake. NULL on pre-0039 loans. Frozen for the life of the ticket — '
  'if the operator renames the category later, this column does not '
  'follow. Join to pawn_intake_categories on (tenant_id, slug) for '
  'live label lookup; fall back to the raw slug if no row matches.';

COMMENT ON COLUMN public.loans.pawn_subcategory_slug IS
  'Slug snapshot of the sub-category row, when the picked top-level '
  'has subs. NULL when the top-level has no subs (e.g., general) OR '
  'on pre-0039 loans. Same freeze + display-fallback rules as '
  'pawn_category_slug.';

-- Analytics index — "show me the loan distribution by category for
-- this tenant over the last 90 days". Partial so we don't bloat the
-- index with the long pre-0039 NULL tail.
CREATE INDEX IF NOT EXISTS idx_loans_pawn_category
  ON public.loans (tenant_id, pawn_category_slug, issue_date DESC)
  WHERE pawn_category_slug IS NOT NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
-- After running, the columns should exist and the index should be
-- visible:
--
--   \d public.loans
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='loans'
--      AND indexname='idx_loans_pawn_category';
--
-- ───────────────────────────────────────────────────────────────────────────
