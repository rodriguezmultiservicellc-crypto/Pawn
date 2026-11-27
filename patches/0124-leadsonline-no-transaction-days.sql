-- 0124 — LeadsOnline "No Transactions Day" (Eddy, 2026-11-27).
--
-- LeadsOnline's Transaction Monitor flags every day a store sent no tickets
-- ("Action Required: Set as No Transactions Day"). Its web service has
-- SetNoTransactionDayForStore(login, 'MM/DD/YYYY'). A nightly job
-- (/api/cron/leadsonline-no-transactions) sends it for each finished day the
-- shop wrote no pawn and no buy (compliance_log, rule 15); Settings →
-- LeadsOnline can send one day by hand.
--
-- The job only marks days on or after the first day Sol Pawn got a ticket
-- accepted in that environment — before that another program (xPawn) may
-- have reported that day's tickets.
--
-- One row per call and its answer. A day is never sent twice once accepted
-- (unique on tenant + environment + day where ok). Append-only.
-- RLS: enabled with NO policy — service role only, after the role check.
-- No existing policy is added or changed.

CREATE TABLE IF NOT EXISTS public.leadsonline_no_transaction_days (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id),
  environment     TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  day             DATE NOT NULL,
  ok              BOOLEAN NOT NULL,
  error_code      INTEGER,
  error_response  TEXT,
  -- NULL = the nightly job; else who pressed the button.
  set_by          UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leadsonline_no_transaction_days_ok
  ON public.leadsonline_no_transaction_days(tenant_id, environment, day)
  WHERE ok;
CREATE INDEX IF NOT EXISTS idx_leadsonline_no_transaction_days_recent
  ON public.leadsonline_no_transaction_days(tenant_id, created_at DESC);

COMMENT ON TABLE public.leadsonline_no_transaction_days IS
  'Days sent to LeadsOnline as "no transactions" (SetNoTransactionDayForStore) and the answer. '
  'Append-only; service role only.';

ALTER TABLE public.leadsonline_no_transaction_days ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.leadsonline_log_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_leadsonline_no_transaction_days_append_only ON public.leadsonline_no_transaction_days;
CREATE TRIGGER trg_leadsonline_no_transaction_days_append_only
  BEFORE UPDATE OR DELETE ON public.leadsonline_no_transaction_days
  FOR EACH ROW EXECUTE FUNCTION public.leadsonline_log_append_only();

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   SELECT count(*) FROM pg_policies WHERE tablename = 'leadsonline_no_transaction_days';  → 0
