-- ───────────────────────────────────────────────────────────────────────────
-- 0026 — public landing pages (Phase 10 Path A, session 1 / N)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0025 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds four columns to `tenants` so each tenant can publish a public
--   landing page on its own subdomain or path-slug (`/s/<slug>`):
--
--     public_slug              CITEXT UNIQUE NULL
--     public_landing_enabled   BOOLEAN NOT NULL DEFAULT FALSE
--     public_about             TEXT
--     public_hours             JSONB
--
--   Plus an unauthenticated SELECT policy on `tenants` that exposes ONLY
--   the columns required to render the landing page, and only when
--   public_landing_enabled = TRUE. This is the first RLS policy in the
--   project that grants access to the `anon` role on a tenant-scoped
--   table — every other tenant policy gates through user_tenants. The
--   policy grants row visibility; column-level discipline lives in the
--   resolver (src/lib/tenant-resolver.ts) which selects only safe
--   columns.
--
--   Backfill is a no-op: existing tenants get NULL slug + DEFAULT FALSE
--   landing flag + NULL about + NULL hours. They're invisible until an
--   operator sets a slug AND flips the toggle.
--
-- Why two flags instead of "slug present implies enabled"
--
--   An operator may want to reserve a slug (preventing a competitor or
--   typo-squatter from claiming "main-st-pawn") without publishing a
--   landing page yet. Decoupling slug ownership from publish state lets
--   us land the slug-claim flow today without forcing a half-baked
--   landing page live.
--
-- Slug shape
--
--   CITEXT to make `acme` and `Acme` collide on UNIQUE without an extra
--   trigger. CHECK constraint enforces the URL-safe shape: lowercase
--   letters, digits, hyphens; 3–40 chars; no leading/trailing hyphen;
--   no consecutive hyphens. Reserved values that collide with platform
--   subdomains are blocked at the application layer (the validation
--   schema), not at the DB layer — easier to update without a migration.
--
-- Hours JSONB shape
--
--   { "mon": { "open": "09:00", "close": "18:00", "closed": false },
--     "tue": ... }
--   Keys are mon/tue/wed/thu/fri/sat/sun. `closed: true` short-circuits
--   open/close. Missing days are treated the same as `closed: true`.
--   Validation lives in the Zod schema; the DB column is permissive
--   JSONB so future shape changes (multiple intervals per day, holiday
--   overrides) don't require a migration.
--
-- Followups (NOT included in this patch)
--
--   - Run `npm run db:types` after applying so src/types/database.ts
--     picks up the new columns. The settings/general action and the
--     tenant-resolver have a temporary `as never` cast at the boundary
--     until that runs (same dance as 0024 + 0025 in Session 18).
--   - Wildcard DNS at the production base domain — Vercel needs a
--     `*.<basedomain>` record + the domain attached to the project. The
--     path form (`/s/<slug>`) works without DNS so the page ships
--     functional today regardless.
--
-- Rollback
--
--   DROP POLICY IF EXISTS tenants_public_landing_select ON tenants;
--   ALTER TABLE tenants DROP COLUMN IF EXISTS public_hours;
--   ALTER TABLE tenants DROP COLUMN IF EXISTS public_about;
--   ALTER TABLE tenants DROP COLUMN IF EXISTS public_landing_enabled;
--   ALTER TABLE tenants DROP COLUMN IF EXISTS public_slug;
--   DROP INDEX IF EXISTS tenants_public_slug_lower_idx;
--   The columns have no FKs and the policy is additive — clean rollback.
-- ============================================================================

-- CITEXT for case-insensitive slug uniqueness without a normalizing trigger.
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS public_slug             CITEXT,
  ADD COLUMN IF NOT EXISTS public_landing_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_about            TEXT,
  ADD COLUMN IF NOT EXISTS public_hours            JSONB;

-- URL-safe slug shape. CITEXT makes the UNIQUE case-insensitive; the
-- regex enforces lowercase canonicalization at write time so saved values
-- match what shows in the URL bar.
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_public_slug_shape;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_public_slug_shape
  CHECK (
    public_slug IS NULL
    OR (
      length(public_slug::text) BETWEEN 3 AND 40
      AND public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
  );

-- UNIQUE on the slug. Partial index so multiple NULLs are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_public_slug_unique_idx
  ON tenants (public_slug)
  WHERE public_slug IS NOT NULL;

COMMENT ON COLUMN tenants.public_slug IS
  'URL-safe public identifier for the tenant landing page. NULL until '
  'the operator claims one in /settings/general. CITEXT + UNIQUE: case-'
  'insensitive collisions blocked. Shape: 3-40 chars, lowercase, digits, '
  'hyphens; no leading/trailing hyphen. Reserved platform names (admin, '
  'api, app, www, portal, staff, settings) blocked at the validation '
  'layer.';

COMMENT ON COLUMN tenants.public_landing_enabled IS
  'When TRUE, the public landing page at /s/<public_slug> (and at '
  '<public_slug>.<base_domain> when wildcard DNS lands) is rendered. '
  'When FALSE, the page returns 404 even if the slug is set. Decoupled '
  'from public_slug so an operator can reserve a slug without publishing.';

COMMENT ON COLUMN tenants.public_about IS
  'Free-text "about us" body shown on the public landing page. Plain '
  'text only — no HTML/Markdown rendering for v1. NULL hides the section.';

COMMENT ON COLUMN tenants.public_hours IS
  'Per-day hours rendered on the public landing page. Shape: '
  '{ mon: { open: "09:00", close: "18:00", closed: false }, tue: ..., '
  'sun: ... }. Missing days render as Closed. Permissive JSONB at the '
  'DB layer; Zod schema enforces shape at write time.';

-- ── Public-read RLS policy ─────────────────────────────────────────────
-- The `tenants` table already has RLS enabled (0001-foundation.sql). The
-- existing tenants_select policy gates by user_tenants membership; this
-- additive policy grants the `anon` role row visibility ONLY when the
-- landing is published. Column-level filtering is handled by the
-- resolver — never `SELECT *` on tenants from an unauthenticated path.
DROP POLICY IF EXISTS tenants_public_landing_select ON tenants;
CREATE POLICY tenants_public_landing_select ON tenants
  FOR SELECT
  TO anon, authenticated
  USING (
    public_landing_enabled = TRUE
    AND public_slug IS NOT NULL
    AND is_active = TRUE
  );

-- Tell PostgREST to pick up the new columns + policy without a manual restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0026-tenant-public-landing.sql
-- ============================================================================
