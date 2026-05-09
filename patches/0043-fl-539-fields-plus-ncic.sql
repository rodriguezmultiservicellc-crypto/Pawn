-- ───────────────────────────────────────────────────────────────────────────
-- 0043 — FS 539.001(8)(b)(2) field gaps + NCIC TYP code
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0042 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- Cross-checked the FL Pawnbroking Act § 539.001(8)(b)(2) item
-- description requirements against what we collect today and added
-- the missing fields:
--
--   Color                       → MISSING
--   Gemstone description        → MISSING (jewelry)
--   Firearm finish              → MISSING
--   Firearm number of barrels   → MISSING
--   Other unique marks          → MISSING (today goes into description)
--
-- All five land on loan_collateral_items as nullable columns. Form-
-- conditional rendering (jewelry vs firearms vs common) lives in the
-- /pawn/new UI — DB stays flexible.
--
-- Also adds NCIC Article File / Gun File TYP code to
-- pawn_intake_categories so daily LeadsOnline / RAPID exports can map
-- each category to the agency-accepted code without hard-coding the
-- mapping in TS. Per-tenant + operator-editable in /settings/pawn-
-- categories because the accepted code list varies by jurisdiction.
-- Examples: JEWL (jewelry), TOOL (tools), CMPT (computer), HA (semi-
-- auto handgun), RI (rifle), SH (shotgun).
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- 1. FS 539.001(8)(b)(2) MISSING FIELDS ON loan_collateral_items
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS color TEXT NULL,
  ADD COLUMN IF NOT EXISTS gemstone_description TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_finish TEXT NULL,
  ADD COLUMN IF NOT EXISTS firearm_number_of_barrels INTEGER NULL,
  ADD COLUMN IF NOT EXISTS unique_marks TEXT NULL;

COMMENT ON COLUMN public.loan_collateral_items.color IS
  'FS 539.001(8)(b)(2)(e). Color as apparent to the untrained eye. '
  'Free text — operators write what they see (yellow, white, two-tone, '
  'matte black, desert tan).';

COMMENT ON COLUMN public.loan_collateral_items.gemstone_description IS
  'FS 539.001(8)(b)(2)(g). Free-text description covering count, type, '
  'cut, approximate size of stones in the piece. Jewelry-only at the '
  'UI layer; column allows non-jewelry rows to be NULL. Distinct from '
  'the inventory_item_stones sub-table (used for forfeited inventory) '
  '— that is a structured taxonomy, this is the at-intake snapshot.';

COMMENT ON COLUMN public.loan_collateral_items.firearm_finish IS
  'FS 539.001(8)(b)(2)(h). Firearm finish — blued, stainless, nickel, '
  'parkerized, cerakote (color), etc. Free text. NULL on non-firearm '
  'rows.';

COMMENT ON COLUMN public.loan_collateral_items.firearm_number_of_barrels IS
  'FS 539.001(8)(b)(2)(h). Number of barrels — 1 for most handguns / '
  'rifles, 2 for double-barrel shotguns or derringers, 3+ in rare '
  'cases. NULL on non-firearm rows.';

COMMENT ON COLUMN public.loan_collateral_items.unique_marks IS
  'FS 539.001(8)(b)(2)(i). Any other unique identifying marks / '
  'numbers / names / letters not captured elsewhere — engravings, '
  'stamps, hallmarks, custom inscriptions, scratches with a pattern. '
  'Common across all categories; complements the description rather '
  'than replacing it.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. NCIC TYP CODE ON pawn_intake_categories
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pawn_intake_categories
  ADD COLUMN IF NOT EXISTS ncic_code TEXT NULL;

COMMENT ON COLUMN public.pawn_intake_categories.ncic_code IS
  'NCIC Article File or Gun File TYP code used by daily LeadsOnline / '
  'RAPID exports to law enforcement. Operator-editable in '
  '/settings/pawn-categories because the accepted code list varies by '
  'transmission vendor + jurisdiction. Article File examples: JEWL, '
  'WTCH, TOOL, CMPT, TLVN, COIN, BICY, MUSI. Gun File examples: HA '
  '(semi-auto pistol), RE (revolver), RI (rifle), SH (shotgun). '
  'NULL until the operator sets it.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
--
--   \d public.loan_collateral_items
--     should show 5 new columns: color, gemstone_description,
--     firearm_finish, firearm_number_of_barrels, unique_marks.
--
--   \d public.pawn_intake_categories
--     ncic_code TEXT NULL.
-- ───────────────────────────────────────────────────────────────────────────
