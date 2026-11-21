-- ───────────────────────────────────────────────────────────────────────────
-- 0090 — Size / length on inventory_items
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0089. Append-only.
--
-- Same shape as loan_collateral_items.jewelry_size (patches/0042): one
-- free-text column for ring size or chain / bracelet length, entered the
-- way the gauge or tape reads ("7", "8.5", "22 in", "55 cm"). NULL when it
-- does not apply. Forfeiture copies the collateral value across; the
-- Lightspeed importer fills it from a Size / Length variant option.
--
-- Additive column. No RLS change.
--
-- Rollback:
--   ALTER TABLE inventory_items DROP COLUMN IF EXISTS jewelry_size;
-- ============================================================================

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS jewelry_size TEXT NULL;

COMMENT ON COLUMN inventory_items.jewelry_size IS
  'Free-text ring size (''7'', ''8.5'') or chain/bracelet length (''22 in'', '
  '''55 cm''). NULL when not applicable. Operator-entered, never normalized.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0090-inventory-jewelry-size.sql
-- ============================================================================
