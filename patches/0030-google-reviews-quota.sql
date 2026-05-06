-- ───────────────────────────────────────────────────────────────────────────
-- 0030 — google reviews per-tenant API quota (Phase 10 Path A, slice 4
--        defense-in-depth)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0029 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds a per-tenant rolling-24h quota on Places API calls so a
--   misconfigured tenant (bad API key, broken place_id, or a Google
--   outage that never lets a successful row get cached) cannot trigger
--   unbounded re-fetches against the platform's GOOGLE_PLACES_API_KEY.
--
--   tenant_google_reviews + 2 columns:
--     quota_window_start  TIMESTAMPTZ NULL
--     quota_calls_used    INTEGER NOT NULL DEFAULT 0
--
--   settings + 1 column:
--     google_reviews_daily_quota  INTEGER NULL
--                                  -- NULL → use platform default (50)
--                                  -- per-tenant override for paying customers
--
--   New RPC consume_google_reviews_quota(p_tenant_id, p_place_id, p_cap):
--     Atomic SECURITY DEFINER function that locks the cache row, resets
--     the rolling window if it has elapsed, increments calls_used, and
--     returns TRUE (allowed) / FALSE (denied — at cap).
--
--     If no cache row exists yet, INSERTs a placeholder + starts the
--     window at 1, returning TRUE. The actual payload arrives via the
--     UPSERT in `refreshReviews()` after the Places API call returns.
--
-- Why a rolling 24h window (not calendar day)
--
--   Burst-resistant. Calendar-day quotas double in cost near the
--   boundary because tenants near 23:59 UTC can do 50 calls then 50
--   more right after midnight. Rolling 24h smooths that out.
--
-- Why count failures too
--
--   The cap protects against retry storms where every public visitor
--   triggers a new fetch because the row stays stale-with-error.
--   Counting only successes would defeat that.
--
-- Why a SECURITY DEFINER RPC (not a TS-side check)
--
--   Concurrency. Without row-level locking via FOR UPDATE inside the
--   function, two concurrent visitors could each read the counter
--   below the cap and both increment, blowing the quota. The lock
--   serializes them.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── tenant_google_reviews: 2 new columns ────────────────────────────────

ALTER TABLE public.tenant_google_reviews
  ADD COLUMN quota_window_start TIMESTAMPTZ,
  ADD COLUMN quota_calls_used   INTEGER NOT NULL DEFAULT 0;

-- ── settings: 1 new column ──────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN google_reviews_daily_quota INTEGER
    CHECK (google_reviews_daily_quota IS NULL OR google_reviews_daily_quota > 0);

-- ── RPC: consume_google_reviews_quota ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_google_reviews_quota(
  p_tenant_id  UUID,
  p_place_id   TEXT,
  p_cap        INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_calls_used   INTEGER;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  -- Lock the row if it exists. FOR UPDATE serializes concurrent quota
  -- checks against the same tenant.
  SELECT quota_window_start, quota_calls_used
    INTO v_window_start, v_calls_used
    FROM public.tenant_google_reviews
    WHERE tenant_id = p_tenant_id
    FOR UPDATE;

  -- First-ever fetch for this tenant — create a placeholder row + start
  -- the quota window at 1. The actual payload arrives via the UPSERT
  -- inside refreshReviews() after the Places API call returns. Empty
  -- payload {} satisfies the NOT NULL constraint.
  IF NOT FOUND THEN
    INSERT INTO public.tenant_google_reviews (
      tenant_id, place_id, payload, fetched_at,
      quota_window_start, quota_calls_used
    ) VALUES (
      p_tenant_id, p_place_id, '{}'::jsonb, v_now,
      v_now, 1
    )
    ON CONFLICT (tenant_id) DO NOTHING;
    -- Concurrent insert race: ours might lose to another caller's, but
    -- the row will exist with calls_used >= 1 either way. Allow this
    -- call; the next will go through the existing-row branch.
    RETURN TRUE;
  END IF;

  -- Window expired or never started → reset.
  IF v_window_start IS NULL
     OR (v_now - v_window_start) > INTERVAL '24 hours' THEN
    UPDATE public.tenant_google_reviews
      SET quota_window_start = v_now,
          quota_calls_used   = 1
      WHERE tenant_id = p_tenant_id;
    RETURN TRUE;
  END IF;

  -- Within window — check cap.
  IF v_calls_used >= p_cap THEN
    RETURN FALSE;
  END IF;

  -- Allowed: increment.
  UPDATE public.tenant_google_reviews
    SET quota_calls_used = v_calls_used + 1
    WHERE tenant_id = p_tenant_id;
  RETURN TRUE;
END;
$$;

-- Lock down execution. The function mutates rows on a table whose RLS
-- only allows staff SELECT; only the service-role admin client should
-- be calling this. service_role bypasses RLS but we still revoke from
-- PUBLIC + authenticated to make the boundary explicit.
REVOKE ALL ON FUNCTION public.consume_google_reviews_quota(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_google_reviews_quota(UUID, TEXT, INTEGER) TO service_role;

COMMIT;

-- Tell PostgREST to pick up the new columns + RPC without restart.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual — only safe before any quota windows have ticked over)
-- ───────────────────────────────────────────────────────────────────────────
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.consume_google_reviews_quota(UUID, TEXT, INTEGER);
--   ALTER TABLE public.settings
--     DROP COLUMN IF EXISTS google_reviews_daily_quota;
--   ALTER TABLE public.tenant_google_reviews
--     DROP COLUMN IF EXISTS quota_calls_used,
--     DROP COLUMN IF EXISTS quota_window_start;
-- COMMIT;

-- ============================================================================
-- END 0030-google-reviews-quota.sql
-- ============================================================================
