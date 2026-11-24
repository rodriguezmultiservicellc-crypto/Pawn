-- ───────────────────────────────────────────────────────────────────────────
-- 0107 — The rest of FS 539.001(8)(b)2.a-d on loan_collateral_items:
--        tool serial, brand / model / serial for general items, size for
--        everything that is not jewelry
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0106 has already run.
--           Append-only — never edit prior migrations.
--
-- WHY
-- ───
-- Fla. Stat. § 539.001(8)(b)2 (2026 edition, read 2026-11-24) asks the
-- ticket for, "if applicable": a. brand name, b. model number,
-- c. manufacturer's serial number, d. size. Checked against the item
-- popup on 2026-11-24, four holes were left after 0106:
--
--   Tools        brand + model, but no serial (a drill has one)
--   General      description, color and marks only — no brand, model,
--                serial or size (a guitar, a bicycle, a generator)
--   Electronics  no size (a television's screen)
--   Tools        no size (a 10-inch saw, a 20V battery)
--
-- Eddy, 2026-11-24: "fix the remaining".
--
-- WHAT THIS DOES
-- ──────────────
-- Five nullable TEXT columns on the at-intake snapshot row:
--
--   tool_serial      a tool's serial number
--   general_brand    brand of an item in a category with no fields of its
--   general_model    own ("General", or one the shop added)
--   general_serial
--   item_size        size of anything that is not jewelry — "55 in",
--                    "20V", "26 in wheels". Jewelry keeps jewelry_size.
--
-- The category-prefixed names follow 0041 (firearm_*, electronic_*,
-- tool_*) and 0106 (jewelry_*). Every reader coalesces across them.
--
-- NOT TOUCHED: no RLS policy, no trigger, no existing row's values.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS tool_serial    TEXT NULL,
  ADD COLUMN IF NOT EXISTS general_brand  TEXT NULL,
  ADD COLUMN IF NOT EXISTS general_model  TEXT NULL,
  ADD COLUMN IF NOT EXISTS general_serial TEXT NULL,
  ADD COLUMN IF NOT EXISTS item_size      TEXT NULL;

COMMENT ON COLUMN public.loan_collateral_items.tool_serial IS
  'FS 539.001(8)(b)2.c — a tool''s serial number. NULL on non-tool rows.';

COMMENT ON COLUMN public.loan_collateral_items.general_brand IS
  'FS 539.001(8)(b)2.a — brand of an item whose category has no fields of '
  'its own (General, or a category the shop added). NULL elsewhere.';

COMMENT ON COLUMN public.loan_collateral_items.general_model IS
  'FS 539.001(8)(b)2.b — model of such an item. NULL elsewhere.';

COMMENT ON COLUMN public.loan_collateral_items.general_serial IS
  'FS 539.001(8)(b)2.c — serial number of such an item. NULL elsewhere.';

COMMENT ON COLUMN public.loan_collateral_items.item_size IS
  'FS 539.001(8)(b)2.d — free-text size of an item that is not jewelry '
  '("55 in", "20V", "26 in wheels"). Jewelry uses jewelry_size.';

CREATE INDEX IF NOT EXISTS idx_loan_collateral_items_tool_serial
  ON public.loan_collateral_items (tenant_id, tool_serial)
  WHERE tool_serial IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_loan_collateral_items_general_serial
  ON public.loan_collateral_items (tenant_id, general_serial)
  WHERE general_serial IS NOT NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'loan_collateral_items'
--      AND column_name IN ('tool_serial','general_brand','general_model',
--                          'general_serial','item_size');
--     → 5
-- ───────────────────────────────────────────────────────────────────────────
