-- ───────────────────────────────────────────────────────────────────────────
-- 0088 — Keep WHY / WHEN / WHO a sale was voided on the sale itself
-- ───────────────────────────────────────────────────────────────────────────
-- Apply to: project kjyaxfwlggxiqijiiuna AFTER 0087.
--
-- The void reason (required, ≥10 chars) only lived in audit_log, so the
-- sale page could not show it. Now:
--   sales.void_reason  text      (the clerk's reason)
--   sales.voided_at    timestamptz
--   sales.voided_by    uuid      (the user who voided)
-- Write-once: once voided_at is set, none of the three can change — a void
-- is a record, not a note (trigger sales_void_fields_write_once).
-- Backfill: every already-voided sale from its audit_log 'sale_void' row.
-- RLS: no policy added or changed.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_void_reason_len;
ALTER TABLE public.sales ADD CONSTRAINT sales_void_reason_len
  CHECK (void_reason IS NULL OR char_length(void_reason) <= 2000);

CREATE OR REPLACE FUNCTION public.sales_void_fields_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.voided_at IS NOT NULL AND (
       NEW.voided_at   IS DISTINCT FROM OLD.voided_at
    OR NEW.voided_by   IS DISTINCT FROM OLD.voided_by
    OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
  ) THEN
    RAISE EXCEPTION 'sale void details are write-once (sale %)', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sales_void_fields_write_once ON public.sales;
CREATE TRIGGER trg_sales_void_fields_write_once
  BEFORE UPDATE OF voided_at, voided_by, void_reason ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_void_fields_write_once();

-- Backfill from the audit trail (latest sale_void row per sale).
UPDATE public.sales s
   SET void_reason = a.reason,
       voided_at   = a.created_at,
       voided_by   = a.user_id
  FROM (
    SELECT DISTINCT ON (record_id)
           record_id, created_at, user_id, changes ->> 'reason' AS reason
      FROM public.audit_log
     WHERE action = 'sale_void' AND table_name = 'sales'
     ORDER BY record_id, created_at DESC
  ) a
 WHERE s.id = a.record_id
   AND s.status = 'voided'
   AND s.voided_at IS NULL;
