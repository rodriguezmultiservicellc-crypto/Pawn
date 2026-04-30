-- ───────────────────────────────────────────────────────────────────────────
-- 0024 — tenants.agency_store_id (police-report store identifier)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0023 has already run.
--           Append-only — never edit prior migrations.
--
-- What changes
--
--   Adds `agency_store_id TEXT` to `tenants`. This is the
--   compliance-agency-assigned store identifier used in police-report
--   exports (LeadsOnline et al.). Different from `tenants.id` (our
--   internal UUID). Nullable — a tenant can exist before LeadsOnline has
--   assigned an ID, and the exporter falls back to the UUID in that case
--   so existing rows continue working unchanged.
--
--   Backfill is a no-op: every existing tenant gets NULL until the
--   operator enters the value in /settings/general.
--
-- Why this is its own migration
--
--   Patch 0011-reporting.sql commented this column as "land when we have
--   a paying tenant with a LeadsOnline store_id." That moment has
--   arrived in fact-pattern terms (the police-report exporter has
--   shipped and the UUID fallback shows up in the police-report code
--   path), so the column lands here.
--
-- Followups (NOT included in this patch)
--
--   - Run `npm run db:types` after applying so src/types/database.ts
--     picks up the new column.
--   - The tenant-scope resolver (src/lib/reports/tenant-scope.ts) now
--     reads this column and falls back to tenant.id when NULL/empty.
--   - /settings/general gains the field as editable for owner /
--     chain_admin (police_report_format remains read-only since it
--     gates the exporter's format dispatcher).
--
-- Rollback
--
--   ALTER TABLE tenants DROP COLUMN agency_store_id;
--   The column has no FK and no dependent index, so DROP is clean.
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS agency_store_id TEXT;

COMMENT ON COLUMN tenants.agency_store_id IS
  'Compliance-agency-assigned store identifier (e.g. LeadsOnline store_id). '
  'NULL until the operator enters it in /settings/general. The police-report '
  'exporter falls back to tenants.id (UUID) when this column is NULL or '
  'empty so tenants without a LeadsOnline assignment can still produce '
  'well-formed exports for review.';

-- Tell PostgREST to pick up the new column without a manual restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END 0024-tenant-agency-store-id.sql
-- ============================================================================
