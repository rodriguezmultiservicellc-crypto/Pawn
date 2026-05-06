-- ───────────────────────────────────────────────────────────────────────────
-- 0031 — google reviews per-tenant hidden review list (Phase 10 Path A,
--        slice 4 defense-in-depth)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0030 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds a per-review hide list so an operator can suppress an
--   individual review on the public widget without raising the
--   min-star floor for everyone. Useful for: profanity, off-topic
--   reviews, content the operator believes is fraudulent but doesn't
--   want to dispute via Google's flow.
--
--   settings + 1 column:
--     google_reviews_hidden_review_times  BIGINT[] NOT NULL DEFAULT '{}'
--
--   Stored as the Google review's `time` field (unix seconds), which
--   is the closest thing to a stable identifier in the Places Details
--   payload. `time` is theoretically non-unique but practically so;
--   collisions would require two reviews of the same shop landing in
--   the same exact second, which doesn't happen at this scale.
--
-- Why a column on settings (not a separate table)
--
--   The hide list is small (at most 5 entries — Google returns up to 5
--   reviews and we render up to 3). A column on settings keeps the
--   query path identical to min_star_floor: one settings read on the
--   public page already loads it, no second join. If Google ever
--   exposes a stable review ID and we need richer metadata
--   (hidden_at / hidden_by) we can migrate to a join table.
--
-- Why filter at render-time, not at fetch-time
--
--   The hide list mutates faster than the cache TTL. Filtering at
--   render lets operators hide a review and see it disappear on the
--   next page load without waiting up to 24h for a fresh fetch. The
--   raw payload stays intact in tenant_google_reviews.payload so the
--   filter can be reversed instantly.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.settings
  ADD COLUMN google_reviews_hidden_review_times BIGINT[] NOT NULL DEFAULT '{}';

COMMIT;

-- Tell PostgREST to pick up the new column without a restart.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- ───────────────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   ALTER TABLE public.settings
--     DROP COLUMN IF EXISTS google_reviews_hidden_review_times;
-- COMMIT;

-- ============================================================================
-- END 0031-google-reviews-hidden-ids.sql
-- ============================================================================
