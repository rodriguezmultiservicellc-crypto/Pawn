-- ───────────────────────────────────────────────────────────────────────────
-- 0029 — google reviews (Phase 10 Path A, slice 4)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0028 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds per-tenant Google Reviews embed support:
--
--     settings + 3 columns:
--       google_place_id                  TEXT
--       google_places_api_key            TEXT     -- per-tenant override; nullable
--       google_reviews_min_star_floor    SMALLINT NOT NULL DEFAULT 4
--                                          CHECK (BETWEEN 1 AND 5)
--
--     tenant_google_reviews (NEW table) — append-only-ish cache, one row per tenant:
--       tenant_id PK, place_id, payload JSONB, rating NUMERIC(3,2),
--       total_review_count INTEGER, fetched_at TIMESTAMPTZ NOT NULL,
--       last_error TEXT, last_error_at TIMESTAMPTZ
--
--     One index:
--       idx_tenant_google_reviews_fetched_at on (fetched_at)
--         WHERE last_error IS NULL  -- for future cron warmer's "find stale" query
--
-- RLS
--
--   tenant_google_reviews: staff SELECT only via my_tenant_ids().
--   No INSERT/UPDATE/DELETE policies — writes go through admin client only.
--   The public landing route reads via admin client (same pattern as catalog
--   inventory_item_photos signed URLs), so no anon SELECT policy is needed.
--
-- Why settings (not tenants) for the per-tenant config
--
--   The cross-cutting public-surface gates live on tenants
--   (public_landing_enabled, public_catalog_enabled). The per-tenant config
--   for a feature lives on settings (loyalty_*, twilio_*, resend_*).
--   Google Reviews is the latter: place_id, api key override, min-star floor
--   are all feature config, not surface gates. The implicit gate is
--   "google_place_id IS NOT NULL" combined with public_landing_enabled.
--
-- Why a separate cache table (not a JSONB column on settings)
--
--   Settings has a single row per tenant and is read on most page loads.
--   Putting a multi-KB Place Details payload there would bloat every read.
--   The cache table is read only by the public landing route + the staff
--   integrations surface. Separation of concerns also lets last_error /
--   last_error_at evolve without touching settings.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── settings: 3 new columns ──────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN google_place_id TEXT,
  ADD COLUMN google_places_api_key TEXT,
  ADD COLUMN google_reviews_min_star_floor SMALLINT NOT NULL DEFAULT 4
    CHECK (google_reviews_min_star_floor BETWEEN 1 AND 5);

-- ── tenant_google_reviews: new cache table ──────────────────────────────

CREATE TABLE public.tenant_google_reviews (
  tenant_id           UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  place_id            TEXT NOT NULL,
  payload             JSONB NOT NULL,
  rating              NUMERIC(3,2),
  total_review_count  INTEGER,
  fetched_at          TIMESTAMPTZ NOT NULL,
  last_error          TEXT,
  last_error_at       TIMESTAMPTZ
);

CREATE INDEX idx_tenant_google_reviews_fetched_at
  ON public.tenant_google_reviews (fetched_at)
  WHERE last_error IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.tenant_google_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_google_reviews_staff_select
  ON public.tenant_google_reviews FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT public.my_tenant_ids()));

-- No INSERT/UPDATE/DELETE policies — writes are admin-client only.
-- (The on-demand fill in lib/google-reviews/cache.ts uses the service-role
-- client; the future cron warmer at /api/cron/refresh-google-reviews will
-- do the same.)

COMMIT;

-- Tell PostgREST to pick up the new columns + table + policies without restart.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual — apply only if you need to back out before any cache
-- rows have been written)
-- ───────────────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   DROP TABLE IF EXISTS public.tenant_google_reviews;
--   ALTER TABLE public.settings
--     DROP COLUMN IF EXISTS google_reviews_min_star_floor,
--     DROP COLUMN IF EXISTS google_places_api_key,
--     DROP COLUMN IF EXISTS google_place_id;
-- COMMIT;

-- ============================================================================
-- END 0029-google-reviews.sql
-- ============================================================================
