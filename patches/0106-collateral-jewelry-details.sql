-- ───────────────────────────────────────────────────────────────────────────
-- 0106 — Jewelry details on loan_collateral_items: gender, style,
--        brand / model / serial, and stones in boxes
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0105 has already run.
--           Append-only — never edit prior migrations.
--
-- WHY
-- ───
-- Eddy, 2026-11-24, comparing the New pawn ticket item popup with his old
-- system (xPawn) and with Fla. Stat. § 539.001(8)(b)2 (2026 edition, read
-- 2026-11-24 on leg.state.fl.us): "in jewelry we are missing gender and
-- some other things". He picked all four of:
--
--   - Gender and Style — xPawn's ItemSex and Style columns. Not in the
--     statute; they are how the shop tells one gold chain from another.
--   - Brand, model, serial number — § 539.001(8)(b)2.a, b, c ("Brand
--     name.", "Model number.", "Manufacturer's serial number."), "if
--     applicable". Electronics, tools and firearms already had them; a
--     watch or a signed piece under Jewelry had nowhere to put them.
--   - Stones in separate boxes — § 539.001(8)(b)2.g asks for the
--     "Gemstone description, including the number of stones." xPawn kept
--     quantity, type, color, cut and clarity apart; Pawn had one line.
--   - Weight in dwt — a screen matter only. weight_grams stays the one
--     stored weight; nothing here.
--
-- WHAT THIS DOES
-- ──────────────
-- Seven columns, all on the at-intake snapshot row:
--
--   jewelry_gender   'men' | 'women' | 'unisex' | 'child' | NULL
--   jewelry_style    free text ("Cuban link", "Solitaire", "Band")
--   jewelry_brand    free text ("Rolex", "Gucci")
--   jewelry_model    free text / reference number
--   jewelry_serial   free text
--   stones           JSONB array, one object per kind of stone:
--                      { qty, type, carat, color, cut, clarity }
--                    qty and carat are numbers or null; the rest text.
--   gemstone_notes   free text — whatever does not fit the boxes
--
-- gemstone_description STAYS and stays the text every reader prints and
-- reports (ticket, police export, ticket page, 20,563 imported items). For
-- a ticket written in Pawn it is now COMPOSED by createLoanAction from
-- `stones` + `gemstone_notes` (lib/pawn/stones.ts gemstoneText) — one
-- writer, at intake, on a row that never changes afterwards.
--
-- NOT TOUCHED: no RLS policy, no trigger, no existing row's values. The
-- new columns are NULL (stones: '[]') on every existing row, imported
-- ones included — adding a column with a constant default rewrites
-- nothing and fires no row trigger, so loans.updated_at (rule 22) is
-- untouched.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS jewelry_gender TEXT NULL,
  ADD COLUMN IF NOT EXISTS jewelry_style  TEXT NULL,
  ADD COLUMN IF NOT EXISTS jewelry_brand  TEXT NULL,
  ADD COLUMN IF NOT EXISTS jewelry_model  TEXT NULL,
  ADD COLUMN IF NOT EXISTS jewelry_serial TEXT NULL,
  ADD COLUMN IF NOT EXISTS stones JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gemstone_notes TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loan_collateral_items_jewelry_gender_check'
      AND conrelid = 'public.loan_collateral_items'::regclass
  ) THEN
    ALTER TABLE public.loan_collateral_items
      ADD CONSTRAINT loan_collateral_items_jewelry_gender_check
      CHECK (jewelry_gender IS NULL
             OR jewelry_gender IN ('men', 'women', 'unisex', 'child'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loan_collateral_items_stones_array_check'
      AND conrelid = 'public.loan_collateral_items'::regclass
  ) THEN
    ALTER TABLE public.loan_collateral_items
      ADD CONSTRAINT loan_collateral_items_stones_array_check
      CHECK (jsonb_typeof(stones) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN public.loan_collateral_items.jewelry_gender IS
  'Who the piece is made for: men / women / unisex / child. NULL when not '
  'recorded and on non-jewelry rows. Not required by FS 539.001; carried '
  'over from the shop''s old system (xPawn ItemSex).';

COMMENT ON COLUMN public.loan_collateral_items.jewelry_style IS
  'Free-text style: Cuban link, Figaro, Rope, Band, Solitaire, Cluster, '
  'Nugget. NULL on non-jewelry rows. Not required by FS 539.001.';

COMMENT ON COLUMN public.loan_collateral_items.jewelry_brand IS
  'FS 539.001(8)(b)2.a — brand name, for a watch or a signed piece '
  '(Rolex, Gucci, Tiffany). NULL on non-jewelry rows; electronics, tools '
  'and firearms keep their own brand / make columns.';

COMMENT ON COLUMN public.loan_collateral_items.jewelry_model IS
  'FS 539.001(8)(b)2.b — model or reference number of a watch or signed '
  'piece. NULL on non-jewelry rows.';

COMMENT ON COLUMN public.loan_collateral_items.jewelry_serial IS
  'FS 539.001(8)(b)2.c — manufacturer''s serial number of a watch or '
  'signed piece. NULL on non-jewelry rows.';

COMMENT ON COLUMN public.loan_collateral_items.stones IS
  'FS 539.001(8)(b)2.g, in boxes. JSONB array of '
  '{qty, type, carat, color, cut, clarity}: qty (how many) and carat '
  '(total for that line) are numbers or null, the rest text. ''[]'' when '
  'none, on non-jewelry rows and on every row older than this patch. '
  'The at-intake snapshot; inventory_item_stones is the inventory side.';

COMMENT ON COLUMN public.loan_collateral_items.gemstone_notes IS
  'Free text about the stones that does not fit the boxes ("prong-set", '
  '"one stone missing"). gemstone_description is `stones` + this, '
  'composed once at intake.';

-- "Is this watch already in our system?" + police look-ups by serial, the
-- same as the firearm and electronics serial indexes (0041).
CREATE INDEX IF NOT EXISTS idx_loan_collateral_items_jewelry_serial
  ON public.loan_collateral_items
     (tenant_id, jewelry_serial)
  WHERE jewelry_serial IS NOT NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'loan_collateral_items'
--      AND column_name IN ('jewelry_gender','jewelry_style','jewelry_brand',
--                          'jewelry_model','jewelry_serial','stones',
--                          'gemstone_notes');
--     → 7 rows; stones is jsonb NOT NULL DEFAULT '[]'.
--
--   SELECT count(*) FROM loan_collateral_items WHERE stones <> '[]'::jsonb;
--     → 0 right after applying.
-- ───────────────────────────────────────────────────────────────────────────
