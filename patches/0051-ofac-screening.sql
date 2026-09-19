-- ============================================================================
-- PAWN — OFAC SDN SCREENING
-- File:    patches/0051-ofac-screening.sql
-- Date:    2026-09-18
-- Purpose: Screen pledgors / sellers against the Treasury OFAC Specially
--          Designated Nationals list at pawn + buy intake.
--            - ofac_list_versions / ofac_sdn_names: the published list
--              (individuals + aliases), refreshed daily by
--              /api/cron/refresh-ofac. Versioned so every screening records
--              exactly which list it ran against.
--            - ofac_candidates(): trigram candidate search (GIN index); the
--              app scores candidates precisely (src/lib/compliance/ofac).
--            - ofac_screenings: append-only screening record per customer;
--              only the review fields may change (manager clears a false
--              positive or confirms a match).
--            - settings.ofac_screening_enabled (default ON).
--
-- Apply to: existing project AFTER 0050. Append-only.
-- After apply: run `npm run db:types`, then trigger /api/cron/refresh-ofac
--              once to load the first list version.
--
-- Design notes:
--   - The SDN list is public government data: readable by any signed-in
--     user, writable only by the service-role cron.
--   - ofac_screenings RLS = standard tenant staff read. No write policies:
--     screenings are inserted and reviewed through server actions that
--     guard FIRST (requireRoleInTenant) and write with the service role.
--     NEW tables, NEW policies — no existing policy changes.
--   - A potential match is an alert for review, not an identity finding.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ── 1. List versions + names ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ofac_list_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_sha256     TEXT NOT NULL UNIQUE,
  published_on      DATE,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  individual_count  INTEGER NOT NULL DEFAULT 0,
  name_count        INTEGER NOT NULL DEFAULT 0,
  is_current        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ofac_list_versions_current
  ON ofac_list_versions (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS ofac_sdn_names (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id  UUID NOT NULL REFERENCES ofac_list_versions(id) ON DELETE CASCADE,
  ent_num     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  is_alias    BOOLEAN NOT NULL DEFAULT FALSE,
  programs    TEXT,
  remarks     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ofac_sdn_names_version ON ofac_sdn_names(version_id);
CREATE INDEX IF NOT EXISTS idx_ofac_sdn_names_trgm
  ON ofac_sdn_names USING GIN (name_norm extensions.gin_trgm_ops);

ALTER TABLE ofac_list_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ofac_sdn_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofac_list_versions_read ON ofac_list_versions;
CREATE POLICY ofac_list_versions_read ON ofac_list_versions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS ofac_sdn_names_read ON ofac_sdn_names;
CREATE POLICY ofac_sdn_names_read ON ofac_sdn_names FOR SELECT
  USING (auth.role() = 'authenticated');

-- Atomically make one version current and prune all but it + its
-- predecessor (screenings keep their version_id via ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION ofac_activate_version(p_version_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev UUID;
BEGIN
  SELECT id INTO v_prev FROM ofac_list_versions WHERE is_current;
  UPDATE ofac_list_versions SET is_current = FALSE WHERE is_current;
  UPDATE ofac_list_versions SET is_current = TRUE WHERE id = p_version_id;
  DELETE FROM ofac_list_versions
   WHERE id <> p_version_id
     AND (v_prev IS NULL OR id <> v_prev);
END;
$$;

-- Trigram candidates in the current list for a normalized (sorted-token)
-- name. The app does the precise scoring.
CREATE OR REPLACE FUNCTION ofac_candidates(p_query TEXT, p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  version_id UUID,
  ent_num    INTEGER,
  name       TEXT,
  is_alias   BOOLEAN,
  programs   TEXT,
  remarks    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET pg_trgm.similarity_threshold = 0.3
AS $$
  SELECT n.version_id, n.ent_num, n.name, n.is_alias, n.programs, n.remarks
    FROM ofac_sdn_names n
    JOIN ofac_list_versions v ON v.id = n.version_id AND v.is_current
   WHERE n.name_norm % p_query
   ORDER BY similarity(n.name_norm, p_query) DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION ofac_activate_version(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ofac_candidates(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ofac_activate_version(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION ofac_candidates(TEXT, INTEGER) TO service_role;

-- ── 2. Screenings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ofac_screenings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  list_version_id  UUID REFERENCES ofac_list_versions(id) ON DELETE SET NULL,
  list_fetched_at  TIMESTAMPTZ,
  screened_name    TEXT NOT NULL,
  screened_dob     DATE,
  context          TEXT NOT NULL
                   CHECK (context IN ('customer_create','pawn_intake','buy_intake','manual')),
  result           TEXT NOT NULL CHECK (result IN ('clear','potential_match','unavailable')),
  matches          JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_score        NUMERIC(5,4) NOT NULL DEFAULT 0,
  review_status    TEXT NOT NULL
                   CHECK (review_status IN ('not_required','pending','cleared','confirmed')),
  review_note      TEXT,
  reviewed_by      UUID REFERENCES auth.users(id),
  reviewed_at      TIMESTAMPTZ,
  carried_from     UUID REFERENCES ofac_screenings(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ofac_screenings_review_shape CHECK (
    (result = 'potential_match') = (review_status <> 'not_required')
  )
);

CREATE INDEX IF NOT EXISTS idx_ofac_screenings_customer
  ON ofac_screenings(tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ofac_screenings_pending
  ON ofac_screenings(tenant_id) WHERE review_status = 'pending';

COMMENT ON TABLE ofac_screenings IS
  'Append-only OFAC screening record. Only review_status / review_note / reviewed_by / reviewed_at may change (pending -> cleared | confirmed).';

-- Append-only: block deletes and any change outside the review fields;
-- a review can only move a pending screening to cleared / confirmed.
CREATE OR REPLACE FUNCTION ofac_screenings_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Foreign-key cascades (tenant / customer removal, list-version pruning
  -- nulling list_version_id) run at trigger depth > 1 — let them through.
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ofac_screenings is append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.tenant_id, NEW.customer_id, NEW.list_version_id, NEW.screened_name,
      NEW.screened_dob, NEW.context, NEW.result, NEW.matches, NEW.top_score,
      NEW.carried_from, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.customer_id, OLD.list_version_id, OLD.screened_name,
      OLD.screened_dob, OLD.context, OLD.result, OLD.matches, OLD.top_score,
      OLD.carried_from, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'ofac_screenings: only review fields can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     AND NOT (OLD.review_status = 'pending' AND NEW.review_status IN ('cleared','confirmed')) THEN
    RAISE EXCEPTION 'ofac_screenings: invalid review transition % -> %',
      OLD.review_status, NEW.review_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_ofac_screenings_guard ON ofac_screenings;
CREATE TRIGGER trg_ofac_screenings_guard
BEFORE UPDATE OR DELETE ON ofac_screenings
FOR EACH ROW EXECUTE FUNCTION ofac_screenings_guard();

ALTER TABLE ofac_screenings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofac_screenings_staff_read ON ofac_screenings;
CREATE POLICY ofac_screenings_staff_read ON ofac_screenings FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );
-- No write policies: service role only, behind server-action guards.

-- ── 3. Tenant toggle ────────────────────────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS ofac_screening_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN settings.ofac_screening_enabled IS
  'Screen pledgors / sellers against the OFAC SDN list at pawn + buy intake.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0051-ofac-screening.sql
-- ============================================================================
