-- ───────────────────────────────────────────────────────────────────────────
-- 0042 — Jewelry size/length field on loan_collateral_items
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0041 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- Adds a single nullable TEXT column for the size-or-length field on
-- jewelry collateral rows. One column covers both because the operator
-- enters it as free text:
--
--   Rings    → "7", "8.5"          (US ring size)
--   Chains   → "22 in", "55 cm"    (length)
--   Bracelets → "7.5"               (length in inches)
--   Earrings  → usually NULL
--
-- Free text is the right shape — operators copy whatever the customer
-- says or what the gauge / tape measure shows; we never need to do
-- math on it. NULL on non-jewelry rows.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.loan_collateral_items
  ADD COLUMN IF NOT EXISTS jewelry_size TEXT NULL;

COMMENT ON COLUMN public.loan_collateral_items.jewelry_size IS
  'Free-text size for rings (e.g., ''7'', ''8.5'') or length for '
  'chains/bracelets (e.g., ''22 in'', ''55 cm''). NULL on non-jewelry '
  'rows. Operator-entered, never normalized — what the customer/gauge '
  'reports.';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
--
--   \d public.loan_collateral_items
--     jewelry_size column should exist as TEXT NULL.
-- ───────────────────────────────────────────────────────────────────────────
