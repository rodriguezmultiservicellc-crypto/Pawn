-- ───────────────────────────────────────────────────────────────────────────
-- 0044 — compliance_export_batches (daily police-report export artifacts)
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0043 has already run.
--           Append-only — never edit prior migrations.
--
-- WHAT THIS DOES
-- ──────────────
-- The daily LeadsOnline export cron (/api/cron/leadsonline-export) selects
-- the tenant's UNEXPORTED reportable compliance_log rows (exported_at IS
-- NULL, event_type IN pawn_intake/buy_outright), builds the vendor CSV, and:
--   1. INSERTs one row here holding the generated CSV body + batch metadata.
--   2. UPDATEs the covered compliance_log rows SET exported_at, exported_
--      format, exported_batch_id = this batch's id (allowed by the existing
--      compliance_log immutability trigger, which permits only those 3 cols).
--
-- That makes the export deterministic + idempotent: once a compliance_log row
-- is stamped it never re-exports, and the exact CSV submitted for a reporting
-- day is preserved here verbatim (Rule 15 — reporting reads compliance_log,
-- and the artifact is frozen at generation time).
--
-- The CSV body is stored inline (TEXT) rather than in Storage to avoid a new
-- public-less bucket + its storage.objects RLS; rows are gated by the same
-- per-tenant staff RLS as the rest of the schema and streamed by an
-- authenticated download route.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compliance_export_batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  format             public.police_report_format NOT NULL,
  -- Reporting window covered by this batch (inclusive start, exclusive end).
  range_start        TIMESTAMPTZ NOT NULL,
  range_end          TIMESTAMPTZ NOT NULL,
  -- compliance_log rows covered (transactions) and flattened CSV data rows.
  transaction_count  INTEGER NOT NULL DEFAULT 0,
  row_count          INTEGER NOT NULL DEFAULT 0,
  filename           TEXT NOT NULL,
  csv_body           TEXT NOT NULL,
  -- 'cron' for the scheduled job, or a user UUID for a manual export.
  generated_by       TEXT NOT NULL DEFAULT 'cron',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_export_batches_tenant
  ON public.compliance_export_batches(tenant_id, created_at DESC);

COMMENT ON TABLE public.compliance_export_batches IS
  'Frozen daily police-report (LeadsOnline) export artifacts. One row per '
  'generated batch; csv_body is the exact vendor file. compliance_log rows '
  'covered by a batch carry exported_batch_id = this id.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS — mirror compliance_log: per-tenant staff may SELECT (download). No
-- INSERT/UPDATE/DELETE policy → only the service-role client (cron / admin)
-- writes, exactly like compliance_log inserts. DELETE never allowed for any
-- non-service caller (no policy).
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.compliance_export_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compliance_export_batches_staff_read
  ON public.compliance_export_batches;
CREATE POLICY compliance_export_batches_staff_read
  ON public.compliance_export_batches FOR SELECT
  USING (
    tenant_id IN (SELECT my_accessible_tenant_ids())
    AND my_is_staff(tenant_id)
  );

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ───────────────────────────────────────────────────────────────────────────
--   \d public.compliance_export_batches
--   SELECT polname, cmd FROM pg_policies
--     WHERE tablename = 'compliance_export_batches';
--     → one SELECT policy only.
-- ───────────────────────────────────────────────────────────────────────────
