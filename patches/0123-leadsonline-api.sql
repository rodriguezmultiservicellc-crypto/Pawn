-- 0123 — LeadsOnline web service (Eddy, 2026-11-27: LeadsOnline sent the
-- Pawn Industry API document, SOAP samples and a sandbox test store).
--
-- Tickets go to LeadsOnline through its SOAP web service (ticketWS.asmx):
-- SubmitTransaction / UpdateTransaction, built from compliance_log rows only
-- (rule 15). The XML file export (patches/0044, the daily cron) is untouched.
--
-- 1. settings: the shop's API login, minus the password.
--      leadsonline_api_store_id  — the StoreId LeadsOnline gave for the API
--      leadsonline_api_username  — the API user name (not a website login)
--      leadsonline_api_env       — 'sandbox' | 'production'
--    The password lives in Vault only (tenant_secrets kind
--    'leadsonline_api_password', patches/0033).
--
-- 2. leadsonline_submissions: one row per call that carried a ticket —
--    what was sent (the ticket key, void or not, how many images), where
--    (sandbox | production), and LeadsOnline's answer (errorCode /
--    errorResponse). It never holds the request body (customer data,
--    images) or the password. Append-only.
--
-- RLS: enabled with NO policy — only the service-role client reads or
-- writes it, after requireRoleInTenant (rule 10). No existing policy is
-- added or changed.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS leadsonline_api_store_id INTEGER
    CHECK (leadsonline_api_store_id IS NULL OR leadsonline_api_store_id > 0),
  ADD COLUMN IF NOT EXISTS leadsonline_api_username TEXT
    CHECK (leadsonline_api_username IS NULL OR length(leadsonline_api_username) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS leadsonline_api_env TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (leadsonline_api_env IN ('sandbox', 'production'));

COMMENT ON COLUMN public.settings.leadsonline_api_store_id IS
  'LeadsOnline web service StoreId (LoginInfo.storeId). The password is in Vault (leadsonline_api_password).';
COMMENT ON COLUMN public.settings.leadsonline_api_username IS
  'LeadsOnline web service user name (LoginInfo.userName) — not a website login.';
COMMENT ON COLUMN public.settings.leadsonline_api_env IS
  'Which LeadsOnline web service tickets go to: sandbox (testing) or production (real reporting).';

CREATE TABLE IF NOT EXISTS public.leadsonline_submissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id),
  compliance_log_id  UUID NOT NULL REFERENCES public.compliance_log(id),
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  method             TEXT NOT NULL CHECK (method IN ('SubmitTransaction', 'UpdateTransaction')),
  ticket_type        TEXT NOT NULL,
  ticket_number      TEXT NOT NULL,
  ticket_datetime    TEXT NOT NULL,
  is_void            BOOLEAN NOT NULL DEFAULT FALSE,
  images_sent        INTEGER NOT NULL DEFAULT 0,
  -- LeadsOnline's Response; NULL error_code = no Response came back (network
  -- error or SOAP fault), the text is in error_response.
  ok                 BOOLEAN NOT NULL,
  error_code         INTEGER,
  error_response     TEXT,
  submitted_by       UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leadsonline_submissions_row
  ON public.leadsonline_submissions(tenant_id, compliance_log_id, environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leadsonline_submissions_recent
  ON public.leadsonline_submissions(tenant_id, created_at DESC);

COMMENT ON TABLE public.leadsonline_submissions IS
  'Every ticket call to the LeadsOnline web service and its answer. Append-only; '
  'never holds the request body or the password. Service role only.';

ALTER TABLE public.leadsonline_submissions ENABLE ROW LEVEL SECURITY;

-- Append-only: a record of what was reported is never edited or removed.
CREATE OR REPLACE FUNCTION public.leadsonline_submissions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'leadsonline_submissions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_leadsonline_submissions_append_only ON public.leadsonline_submissions;
CREATE TRIGGER trg_leadsonline_submissions_append_only
  BEFORE UPDATE OR DELETE ON public.leadsonline_submissions
  FOR EACH ROW EXECUTE FUNCTION public.leadsonline_submissions_append_only();

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   SELECT leadsonline_api_env FROM settings LIMIT 1;            → 'sandbox'
--   SELECT count(*) FROM pg_policies
--     WHERE tablename = 'leadsonline_submissions';               → 0
