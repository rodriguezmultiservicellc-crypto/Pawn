-- ───────────────────────────────────────────────────────────────────────────
-- 0068 — collections view: configurable aging buckets
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0067 has already run.
--           Append-only — never edit prior migrations.
--
-- Sol Pawn brief, Phase 4.3 — "Aging buckets: On time / Slightly late
-- (1–7 days) / Very late (8–30) / Urgent (30+). Make the day ranges
-- configurable." Two numbers per tenant define the three late buckets:
--   1 .. slight_days          → slightly late
--   slight_days+1 .. very_days → very late
--   > very_days               → urgent
-- ============================================================================

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS collections_slight_days INTEGER NOT NULL DEFAULT 7
    CHECK (collections_slight_days >= 1),
  ADD COLUMN IF NOT EXISTS collections_very_days INTEGER NOT NULL DEFAULT 30
    CHECK (collections_very_days >= 2);

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_collections_buckets_ordered;
ALTER TABLE settings
  ADD CONSTRAINT settings_collections_buckets_ordered
    CHECK (collections_very_days > collections_slight_days);

COMMENT ON COLUMN settings.collections_slight_days IS
  'Collections aging: days late up to and including this = "slightly late".';
COMMENT ON COLUMN settings.collections_very_days IS
  'Collections aging: days late up to and including this = "very late"; beyond = "urgent".';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0068-collections-buckets.sql
-- ============================================================================
